// Disk-backed browser preparation. Only one PBF block and a bounded node-page cache are resident.
(function () {
	const hazards = [
		"obstacle",
		"overgrown",
		"barrier",
		"hazard",
		"hazard:forward",
		"hazard:backward",
	];
	const highways = ["path", "track", "footway", "bridleway", "cycleway"];
	const tags =
		"highway area mtb:scale width est_width surface obstacle overgrown barrier hazard hazard:forward hazard:backward layer bridge tunnel".split(
			" ",
		);
	function request(r) {
		return new Promise(function (resolve, reject) {
			r.onsuccess = () => resolve(r.result);
			r.onerror = () => reject(r.error);
		});
	}
	function finished(tx) {
		return new Promise(function (resolve, reject) {
			tx.oncomplete = resolve;
			tx.onabort = () => reject(tx.error || new Error("Preparation transaction aborted"));
		});
	}
	async function digest(bytes) {
		return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), function (v) {
			return v.toString(16).padStart(2, "0");
		}).join("");
	}
	function create({
		name = "krb-osm-preparation-v1",
		factory = globalThis.indexedDB,
		nodeCacheBytes = 64 * 1024 * 1024,
	} = {}) {
		let db, opening;
		async function open() {
			if (!opening)
				opening = (async function () {
					const r = factory.open(name, 1);
					r.onupgradeneeded = function () {
						for (const store of [
							"meta",
							"coords",
							"directory",
							"shards",
							"lines",
							"compressed",
							"members",
						])
							r.result.createObjectStore(store);
					};
					db = await request(r);
					db.onversionchange = () => db.close();
				})();
			await opening;
		}
		async function get(store, key) {
			await open();
			return request(db.transaction(store).objectStore(store).get(key));
		}
		async function all(store, keys = false) {
			await open();
			const s = db.transaction(store).objectStore(store);
			return request(keys ? s.getAllKeys() : s.getAll());
		}
		async function write(ops) {
			if (!ops.length) return;
			await open();
			const tx = db.transaction([...new Set(ops.map((o) => o[0]))], "readwrite"),
				done = finished(tx);
			for (const [store, key, value] of ops) tx.objectStore(store).put(value, key);
			await done;
		}
		async function clear() {
			await open();
			const tx = db.transaction([...db.objectStoreNames], "readwrite"),
				done = finished(tx);
			for (const store of db.objectStoreNames) tx.objectStore(store).clear();
			await done;
		}
		async function prepare(source, coverage, sourceMetadata, { signal, progress } = {}) {
			await open();
			const identity = JSON.stringify({
				source: [
					sourceMetadata.url,
					sourceMetadata.bytes,
					sourceMetadata.md5,
					sourceMetadata.sha256,
				],
				coverage,
				size: source.size,
			});
			let state = await get("meta", "state");
			if (state && state.identity !== identity) {
				await clear();
				state = null;
			}
			if (!state)
				state = {
					identity,
					offset: 0,
					nodes: 0,
					ways: 0,
					lastNode: 0,
					lastWay: 0,
					pages: 0,
					counts: { way: 0, node: 0 },
					phase: "read",
				};
			if (state.manifest) return state.manifest;
			const directory = await all("directory"),
				shards = new Map((await all("shards")).map((s) => [s.file, s]));
			const members = new Set(await all("members", true)),
				memory = new Map();
			let resident = 0,
				peakResident = 0,
				diskReads = 0;
			function remember(index, page) {
				if (memory.has(index)) resident -= memory.get(index).size;
				const size = page.values.byteLength + JSON.stringify(page.tags).length * 2;
				memory.delete(index);
				if (size <= nodeCacheBytes) {
					memory.set(index, { ...page, size });
					resident += size;
				}
				while (resident > nodeCacheBytes) {
					const first = memory.keys().next().value;
					resident -= memory.get(first).size;
					memory.delete(first);
				}
				peakResident = Math.max(peakResident, resident);
			}
			function pageIndex(id) {
				let low = 0,
					high = directory.length;
				while (low < high) {
					const middle = Math.floor((low + high) / 2);
					if (directory[middle].last < id) low = middle + 1;
					else high = middle;
				}
				if (!directory[low] || directory[low].first > id)
					throw new Error(`Missing source node ${id}`);
				return low;
			}
			async function loadPage(index) {
				let page = memory.get(index);
				if (!page) {
					page = await get("coords", index);
					diskReads++;
					if (!page) throw new Error("Missing coordinate page");
					remember(index, page);
				}
				else {
					memory.delete(index);
					memory.set(index, page);
				}
				return page;
			}
			function nodeFrom(page, id) {
				const values = page.values;
				let low = 0,
					high = values.length / 3;
				while (low < high) {
					const middle = Math.floor((low + high) / 2);
					if (values[middle * 3] < id) low = middle + 1;
					else high = middle;
				}
				if (values[low * 3] !== id) throw new Error(`Missing source node ${id}`);
				return {
					type: "node",
					id,
					lat: values[low * 3 + 1],
					lon: values[low * 3 + 2],
					tags: page.tags[id] || {},
				};
			}
			if (state.phase === "read") {
				await KrbOsmPbf.read(
					source,
					async function (block, checkpoint) {
						signal?.throwIfAborted();
						const ops = [],
							buffers = new Map(),
							touched = new Set();
						let bufferedBytes = 0;
						for (let start = 0; start < block.nodes.length; start += 16384) {
							if (state.ways) throw new Error("Source nodes must precede ways");
							const nodes = block.nodes.slice(start, start + 16384),
								values = new Float64Array(nodes.length * 3),
								hazardTags = {};
							for (let i = 0; i < nodes.length; i++) {
								const node = nodes[i];
								if (!Number.isSafeInteger(node.id) || node.id <= state.lastNode)
									throw new Error("Source nodes must have unique ascending IDs");
								state.lastNode = node.id;
								values.set([node.id, node.lat, node.lon], i * 3);
								if (hazards.some((key) => key in node.tags)) hazardTags[node.id] = node.tags;
							}
							const index = state.pages++,
								entry = { first: nodes[0].id, last: nodes.at(-1).id },
								page = { values, tags: hazardTags };
							directory.push(entry);
							ops.push(["coords", index, page], ["directory", index, entry]);
							state.nodes += nodes.length;
						}
						function emit(item) {
							const points = item.type === "node" ? [item] : item.geometry;
							if (!points.length || (item.type === "way" && points.length < 2))
								throw new Error("Invalid source way geometry");
							const key = `${Math.floor(points[0].lon * 4)}_${Math.floor(points[0].lat * 4)}.ndjson.gz`;
							let entry = shards.get(key);
							if (!entry) {
								entry = {
									file: key,
									bounds: [180, 90, -180, -90],
									records: 0,
									rawBytes: 0,
									parts: 0,
								};
								shards.set(key, entry);
							}
							for (const p of points) {
								entry.bounds[0] = Math.min(entry.bounds[0], p.lon);
								entry.bounds[1] = Math.min(entry.bounds[1], p.lat);
								entry.bounds[2] = Math.max(entry.bounds[2], p.lon);
								entry.bounds[3] = Math.max(entry.bounds[3], p.lat);
							}
							const line = JSON.stringify(item) + "\n";
							const bytes = new TextEncoder().encode(line).length;
							bufferedBytes += bytes;
							if (bytes > 4 * 1024 * 1024 || bufferedBytes > 64 * 1024 * 1024)
								throw new Error("Source block exceeds preparation memory budget");
							buffers.set(key, (buffers.get(key) || "") + line);
							entry.records++;
							state.counts[item.type]++;
							touched.add(key);
						}
						// Node-only blocks commit their pages before subsequent way blocks resolve references.
						if (block.nodes.length && block.ways.length)
							throw new Error("Mixed node/way source blocks are unsupported");
						for (const way of block.ways) {
							if (!Number.isSafeInteger(way.id) || way.id <= state.lastWay)
								throw new Error("Source ways must have unique ascending IDs");
							state.lastWay = way.id;
							state.ways++;
							if (!highways.includes(way.tags.highway) || way.tags.area === "yes") continue;
							const pages = new Map();
							for (const id of way.nodes) {
								const index = pageIndex(id);
								if (!pages.has(index)) pages.set(index, await loadPage(index));
							}
							const nodes = way.nodes.map((id) => nodeFrom(pages.get(pageIndex(id)), id));
							emit({
								type: "way",
								id: way.id,
								tags: way.tags,
								nodes: way.nodes,
								geometry: nodes.map((n) => ({ lat: n.lat, lon: n.lon })),
							});
							for (const node of nodes)
								if (hazards.some((key) => key in node.tags) && !members.has(node.id)) {
									members.add(node.id);
									ops.push(["members", node.id, true]);
									emit(node);
								}
						}
						for (const [key, text] of buffers) {
							const entry = shards.get(key),
								bytes = new TextEncoder().encode(text);
							entry.rawBytes += bytes.length;
							ops.push(["lines", [key, entry.parts++], new Blob([bytes])]);
						}
						for (const key of touched) ops.push(["shards", key, shards.get(key)]);
						Object.assign(state, checkpoint);
						ops.push(["meta", "state", state]);
						await write(ops);
						progress?.({
							phase: "prepare",
							completed: state.offset,
							total: source.size,
							nodes: state.nodes,
							ways: state.counts.way,
							nodeCacheBytes: resident,
						});
					},
					{ signal, offset: state.offset, header: state.header },
				);
				if (!state.counts.way) throw new Error("No relevant Finland ways found");
				state.phase = "compress";
				await write([["meta", "state", state]]);
			}
			const entries = [];
			for (const entry of [...shards.values()].sort((a, b) => a.file.localeCompare(b.file))) {
				signal?.throwIfAborted();
				let compressed = await get("compressed", entry.file);
				if (!compressed) {
					if (entry.rawBytes > 128 * 1024 * 1024)
						throw new Error("Prepared shard exceeds memory budget");
					const parts = [];
					for (let i = 0; i < entry.parts; i++) {
						const part = await get("lines", [entry.file, i]);
						if (!part) throw new Error("Incomplete prepared shard");
						parts.push(part);
					}
					const bytes = new Uint8Array(
						await new Response(
							new Blob(parts).stream().pipeThrough(new CompressionStream("gzip")),
						).arrayBuffer(),
					);
					if (bytes.length > 32 * 1024 * 1024)
						throw new Error("Compressed shard exceeds memory budget");
					compressed = {
						bytes,
						entry: {
							file: entry.file,
							bounds: entry.bounds,
							records: entry.records,
							rawBytes: entry.rawBytes,
							bytes: bytes.length,
							sha256: await digest(bytes),
						},
					};
					await write([["compressed", entry.file, compressed]]);
				}
				entries.push(compressed.entry);
				progress?.({ phase: "compress", completed: entries.length, total: shards.size });
			}
			const manifest = {
				schemaVersion: 1,
				region: "finland",
				...state.header,
				coverage,
				source: sourceMetadata,
				counts: state.counts,
				shards: entries,
				tags,
				highways,
				parser: "krb-osm-pbf-v1",
				license: "ODbL-1.0",
				attribution: "© OpenStreetMap contributors",
				licenseUrl: "https://www.openstreetmap.org/copyright",
			};
			state.manifest = manifest;
			state.metrics = {
				nodes: state.nodes,
				nodePages: directory.length,
				nodeDiskReads: diskReads,
				peakNodeCacheBytes: peakResident,
			};
			await write([["meta", "state", state]]);
			return manifest;
		}
		async function loadShard(entry) {
			const part = await get("compressed", entry.file);
			if (!part) throw new Error("Missing prepared shard");
			return part.bytes;
		}
		async function status() {
			return get("meta", "state");
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
		return { prepare, loadShard, status, clear, discard, close };
	}
	globalThis.KrbOsmPrepare = { create };
})();
