// Persist raw source chunks so interruption can resume a pinned dated extract.
(function () {
	const base = "https://download.geofabrik.de/europe/",
		chunkSize = 8 * 1024 * 1024;
	function request(r) {
		return new Promise(function (resolve, reject) {
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		});
	}
	function finished(tx) {
		return new Promise(function (resolve, reject) {
			tx.oncomplete = resolve;
			tx.onabort = () => reject(tx.error || new Error("Download transaction aborted"));
		});
	}
	function polygon(text) {
		const lines = text.trim().split(/\r?\n/);
		let at = 1;
		const rings = [];
		while (at < lines.length && lines[at].trim() !== "END") {
			const name = lines[at++].trim(),
				coordinates = [];
			while (at < lines.length && lines[at].trim() !== "END") {
				const p = lines[at++].trim().split(/\s+/).map(Number);
				if (
					p.length !== 2 ||
					!p.every(Number.isFinite) ||
					Math.abs(p[0]) > 180 ||
					Math.abs(p[1]) > 90
				)
					throw new Error("Invalid Finland coverage polygon");
				coordinates.push(p);
			}
			if (
				lines[at++]?.trim() !== "END" ||
				coordinates.length < 4 ||
				JSON.stringify(coordinates[0]) !== JSON.stringify(coordinates.at(-1))
			)
				throw new Error("Incomplete Finland coverage polygon");
			rings.push({ hole: name.startsWith("!"), coordinates });
		}
		if (lines[at]?.trim() !== "END" || !rings.some((r) => !r.hole))
			throw new Error("Missing Finland coverage polygon");
		return { format: "osm-poly-rings-v1", rings };
	}
	async function text(response, maximum) {
		if (!response.ok) throw new Error(`OSM download: HTTP ${response.status}`);
		const reader = response.body.getReader(),
			chunks = [];
		let size = 0;
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				size += value.length;
				if (size > maximum) throw new Error("Oversized provider metadata");
				chunks.push(value);
			}
		}
		finally {
			await reader.cancel();
			reader.releaseLock();
		}
		return new TextDecoder("utf-8", { fatal: true }).decode(await new Blob(chunks).arrayBuffer());
	}
	function create({
		name = "krb-osm-download-v1",
		factory = globalThis.indexedDB,
		fetcher = globalThis.fetch,
	} = {}) {
		let db, opening;
		async function open() {
			if (!opening)
				opening = (async function () {
					const r = factory.open(name, 1);
					r.onupgradeneeded = function () {
						r.result.createObjectStore("meta");
						r.result.createObjectStore("chunks");
					};
					db = await request(r);
					db.onversionchange = () => db.close();
				})();
			await opening;
		}
		async function write(work) {
			await open();
			const tx = db.transaction(["meta", "chunks"], "readwrite"),
				done = finished(tx);
			work(tx);
			await done;
		}
		async function get(store, key) {
			await open();
			return request(db.transaction(store).objectStore(store).get(key));
		}
		async function clear() {
			await write(function (tx) {
				tx.objectStore("meta").clear();
				tx.objectStore("chunks").clear();
			});
		}
		async function discover(signal) {
			const response = await fetcher(base + "finland-latest.osm.pbf", {
				method: "HEAD",
				credentials: "omit",
				cache: "no-store",
				signal,
			});
			const url = response.url,
				size = Number(response.headers.get("Content-Length"));
			if (
				!response.ok ||
				!/^https:\/\/download\.geofabrik\.de\/europe\/finland-\d{6}\.osm\.pbf$/.test(url) ||
				!Number.isSafeInteger(size) ||
				size <= 0 ||
				size > 2 * 1024 * 1024 * 1024
			)
				throw new Error("Invalid or oversized dated Finland source");
			const checksum = await text(
					await fetcher(url + ".md5", { credentials: "omit", signal }),
					4096,
				),
				md5 = checksum.trim().split(/\s+/)[0].toLowerCase();
			if (!/^[a-f0-9]{32}$/.test(md5)) throw new Error("Invalid provider checksum");
			const coverage = polygon(
				await text(
					await fetcher(base + "finland.poly", { credentials: "omit", cache: "no-store", signal }),
					2 * 1024 * 1024,
				),
			);
			return { url, bytes: size, md5, etag: response.headers.get("ETag"), coverage };
		}
		async function download(info, { signal, progress } = {}) {
			let state = await get("meta", "source");
			if (
				state &&
				(state.url !== info.url || state.md5 !== info.md5 || state.bytes !== info.bytes)
			) {
				await clear();
				state = null;
			}
			if (!state) state = { ...info, downloaded: 0 };
			if (state.downloaded < state.bytes) {
				const start = state.downloaded;
				const response = await fetcher(info.url, {
					credentials: "omit",
					headers: start
						? { Range: `bytes=${start}-`, ...(info.etag ? { "If-Range": info.etag } : {}) }
						: {},
					signal,
				});
				if (
					start &&
					(response.status !== 206 ||
						response.headers.get("Content-Range") !==
							`bytes ${start}-${info.bytes - 1}/${info.bytes}`)
				) {
					await response.body?.cancel();
					await clear();
					throw new Error("Cannot resume source transfer; retry to restart");
				}
				if (!start && response.status !== 200) {
					await response.body?.cancel();
					throw new Error(`Finland download: HTTP ${response.status}`);
				}
				const reader = response.body.getReader();
				let pending = new Uint8Array(chunkSize),
					used = 0;
				async function commit() {
					const data = new Blob([pending.subarray(0, used)]),
						index = state.downloaded / chunkSize;
					state.downloaded += used;
					await write(function (tx) {
						tx.objectStore("chunks").put(data, index);
						tx.objectStore("meta").put(state, "source");
					});
					progress?.({ phase: "download", completed: state.downloaded, total: state.bytes });
					used = 0;
				}
				try {
					while (true) {
						signal?.throwIfAborted();
						const { value, done } = await reader.read();
						if (done) break;
						let at = 0;
						while (at < value.length) {
							const amount = Math.min(value.length - at, chunkSize - used);
							pending.set(value.subarray(at, at + amount), used);
							used += amount;
							at += amount;
							if (state.downloaded + used > info.bytes)
								throw new Error("Source transfer exceeds declared size");
							if (used === chunkSize) await commit();
						}
					}
					if (state.downloaded + used !== info.bytes)
						throw new Error("Incomplete Finland transfer");
					if (used) await commit();
				}
				finally {
					await reader.cancel();
					reader.releaseLock();
				}
			}
			// Recheck staged source bytes after every interrupted/restarted update.
			{
				const md5 = KrbOsmMd5.create();
				for (let at = 0; at < info.bytes; at += chunkSize) {
					signal?.throwIfAborted();
					const chunk = await get("chunks", at / chunkSize);
					if (!chunk) throw new Error("Missing downloaded source chunk");
					md5.update(new Uint8Array(await chunk.arrayBuffer()));
					progress?.({
						phase: "checksum",
						completed: Math.min(at + chunkSize, info.bytes),
						total: info.bytes,
					});
				}
				if (md5.digest() !== info.md5) {
					await clear();
					throw new Error("Finland source checksum mismatch; retry to download again");
				}
				state.verified = true;
				await write((tx) => tx.objectStore("meta").put(state, "source"));
			}
			let cached,
				cachedAt = -1;
			return {
				size: info.bytes,
				async read(offset, length) {
					if (
						!Number.isSafeInteger(offset) ||
						!Number.isSafeInteger(length) ||
						offset < 0 ||
						length < 0 ||
						offset + length > info.bytes ||
						length > 32 * 1024 * 1024
					)
						throw new Error("Invalid source read");
					const result = new Uint8Array(length);
					let written = 0;
					while (written < length) {
						const index = Math.floor((offset + written) / chunkSize);
						if (index !== cachedAt) {
							const chunk = await get("chunks", index);
							if (!chunk) throw new Error("Missing downloaded chunk");
							cached = new Uint8Array(await chunk.arrayBuffer());
							cachedAt = index;
						}
						const start = offset + written - index * chunkSize,
							amount = Math.min(length - written, cached.length - start);
						if (amount <= 0) throw new Error("Truncated downloaded chunk");
						result.set(cached.subarray(start, start + amount), written);
						written += amount;
					}
					return result;
				},
			};
		}
		async function close() {
			if (!opening) return;
			await opening;
			db.close();
			opening = undefined;
		}
		async function discard() {
			await close();
			await request(factory.deleteDatabase(name));
		}
		return { discover, download, clear, discard, close };
	}
	globalThis.KrbOsmDownload = { create, polygon };
})();
