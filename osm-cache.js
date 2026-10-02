// Geometry lives in its own IndexedDB records; the resident index contains metadata only.
(function () {
	const TTL = 7 * 24 * 60 * 60 * 1000;
	const LEGACY_KEY = "osmHazardsCacheV4";
	function create({ name = "krb-osm-cache-v1", factory = globalThis.indexedDB, storage = globalThis.KrbBrowser?.storage?.local,
		now = Date.now, diskBytes = 512 * 1024 * 1024, memoryBytes = 16 * 1024 * 1024, maxAreas = 4096 } = {}) {
		const entries = new Map(), memory = new Map();
		let db, ready, bytes = 0, residentBytes = 0, queue = Promise.resolve();
		const counters = { memoryHits: 0, diskHits: 0, misses: 0, payloadWrites: 0, metadataWrites: 0 };
		function id(entry) { return `${entry.routeComplete ? "route:" : ""}${entry.key}`; }
		function fresh(entry) { return entry && entry.time <= now() && now() - entry.time < TTL; }
		function request(value) {
			return new Promise(function (resolve, reject) { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
		}
		function finished(transaction) {
			return new Promise(function (resolve, reject) { transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error || new Error("OSM cache transaction aborted")); transaction.onerror = () => {}; });
		}
		async function write(stores, work) {
			const tx = db.transaction(stores, "readwrite"), done = finished(tx);
			try { work(tx); }
			catch (error) {
				tx.abort();
				await Promise.allSettled([done]);
				throw error;
			}
			await done;
		}
		function serial(work) {
			const result = queue.then(work);
			queue = result.catch((error) => console.warn("OSM cache operation failed:", error));
			return result;
		}
		function forget(key) {
			const entry = entries.get(key);
			if (entry) bytes -= entry.bytes;
			entries.delete(key);
			if (memory.has(key)) residentBytes -= memory.get(key).bytes;
			memory.delete(key);
		}
		function remember(entry, data) {
			if (memory.has(entry.id)) residentBytes -= memory.get(entry.id).bytes;
			memory.delete(entry.id);
			memory.set(entry.id, { data, bytes: entry.bytes }); residentBytes += entry.bytes;
			while (residentBytes > memoryBytes && memory.size) {
				const key = memory.keys().next().value;
				residentBytes -= memory.get(key).bytes; memory.delete(key);
				if (!db) { bytes -= entries.get(key)?.bytes || 0; entries.delete(key); }
			}
		}
		async function remove(keys) {
			if (!keys.length) return;
			if (db) {
				await write(["areas", "geometry"], function (tx) {
					for (const key of keys) { tx.objectStore("areas").delete(key); tx.objectStore("geometry").delete(key); }
				});
			}
			for (const key of keys) forget(key);
		}
		async function putEntry(input) {
			const size = new TextEncoder().encode(JSON.stringify(input.data)).byteLength;
			if (size > diskBytes) throw new Error("OSM area exceeds the disk-cache budget");
			const entry = { id: id(input), key: input.key, bounds: input.key.split(",").map(Number), time: input.time,
				accessed: input.accessed ?? now(), routeComplete: input.routeComplete === true, trailSchema: input.data.trailSchema || 0, bytes: size };
			let targetBytes = bytes - (entries.get(entry.id)?.bytes || 0) + size;
			let targetAreas = entries.size + (entries.has(entry.id) ? 0 : 1);
			const victims = [];
			for (const old of [...entries.values()].sort((a, b) => a.accessed - b.accessed)) {
				if (old.id === entry.id) continue;
				if (!fresh(old) || targetBytes > diskBytes || targetAreas > maxAreas) {
					victims.push(old.id); targetBytes -= old.bytes; targetAreas--;
				}
			}
			if (db) {
				await write(["areas", "geometry"], function (tx) {
					for (const key of victims) { tx.objectStore("areas").delete(key); tx.objectStore("geometry").delete(key); }
					tx.objectStore("areas").put(entry);
					tx.objectStore("geometry").put(input.data, entry.id);
				});
			}
			for (const key of victims) forget(key);
			forget(entry.id); entries.set(entry.id, entry); bytes += size;
			remember(entry, input.data);
			counters.payloadWrites++;
		}
		async function init() {
			if (!ready) ready = (async function () {
				try {
					if (!factory) throw new Error("IndexedDB is unavailable; cache is memory-only");
					const opening = factory.open(name, 1);
					opening.onupgradeneeded = function () {
						opening.result.createObjectStore("areas", { keyPath: "id" });
						opening.result.createObjectStore("geometry");
					};
					db = await request(opening);
					db.onversionchange = function () { db.close(); };
					const tx = db.transaction("areas", "readonly");
					for (const entry of await request(tx.objectStore("areas").getAll())) { entries.set(entry.id, entry); bytes += entry.bytes; }
					await remove([...entries.values()].filter((entry) => !fresh(entry)).map((entry) => entry.id));
				}
				catch (error) { console.warn("OSM disk cache unavailable:", error); db?.close(); db = undefined; entries.clear(); bytes = 0; }
				try {
					const saved = await storage?.get(LEGACY_KEY);
					for (const entry of saved?.[LEGACY_KEY] || []) {
						if (!fresh(entry) || typeof entry.key !== "string" || entry.data?.type !== "FeatureCollection") continue;
						if (!entries.has(id(entry))) await putEntry(entry);
					}
					// Remove legacy data only after every migration transaction commits.
					if (db && saved?.[LEGACY_KEY]) await storage?.remove?.(LEGACY_KEY);
				}
				catch (error) { console.warn("OSM legacy cache migration will retry on next startup:", error); }
			})();
			await ready;
		}
		async function list() { await init(); await queue; return entries; }
		async function read(key) {
			await init();
			return serial(async function () {
				const entry = entries.get(key);
				if (!fresh(entry)) { if (entry) await remove([key]); counters.misses++; return undefined; }
				let data = memory.get(key)?.data, source = "memory";
				if (data) counters.memoryHits++;
				else if (db) {
					data = await request(db.transaction("geometry", "readonly").objectStore("geometry").get(key));
					source = "disk";
					if (data) counters.diskHits++;
				}
				if (!data) { await remove([key]); counters.misses++; return undefined; }
				remember(entry, data);
				entry.accessed = now();
				if (db) {
					try {
						await write("areas", (tx) => tx.objectStore("areas").put(entry));
						counters.metadataWrites++;
					}
					catch (error) { console.warn("OSM cache access time could not be saved:", error); }
				}
				return { data, source };
			});
		}
		async function put(entry) {
			await init();
			return serial(async function () {
				try { await putEntry(entry); }
				catch (error) {
					if (error.name !== "QuotaExceededError") throw error;
					// Recover disk space once; do not loop or silently discard the new result.
					const oldest = [...entries.values()].sort((a, b) => a.accessed - b.accessed);
					await remove(oldest.slice(0, Math.max(1, Math.ceil(oldest.length / 4))).map((e) => e.id));
					await putEntry(entry);
				}
			});
		}
		async function clear() {
			await init();
			return serial(async function () {
				if (db) {
					await write(["areas", "geometry"], function (tx) { tx.objectStore("areas").clear(); tx.objectStore("geometry").clear(); });
				}
				entries.clear(); memory.clear(); bytes = 0; residentBytes = 0;
				await storage?.remove?.(LEGACY_KEY);
			});
		}
		function stats() { return { ...counters, areas: entries.size, bytes, residentBytes, residentAreas: memory.size, persistent: Boolean(db), diskLimit: diskBytes, memoryLimit: memoryBytes }; }
		async function close() { await init(); await queue; db?.close(); }
		return { list, read, put, clear, stats, close };
	}
	globalThis.KrbOsmCache = { create };
})();
