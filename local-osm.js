// Immutable regional snapshots, independent of the expiring Overpass cache.
(function () {
	class LocalDataError extends Error {
		constructor(message) { super(message); this.name = "LocalDataError"; }
	}
	const intersects = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
	function boundsValid(b) {
		return Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[0] >= -180 && b[2] <= 180 && b[1] >= -90 && b[3] <= 90 && b[0] <= b[2] && b[1] <= b[3];
	}
	function pointInRing(x, y, points) {
		let inside = false;
		for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
			const a = points[i], b = points[j];
			if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
		}
		return inside;
	}
	function segmentMeetsBox(a, b, box) {
		let low = 0, high = 1;
		for (let axis = 0; axis < 2; axis++) {
			const delta = b[axis] - a[axis];
			if (delta === 0) { if (a[axis] < box[axis] || a[axis] > box[axis + 2]) return false; }
			else {
				const t1 = (box[axis] - a[axis]) / delta, t2 = (box[axis + 2] - a[axis]) / delta;
				low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2));
				if (low > high) return false;
			}
		}
		return true;
	}
	// Conservative at polygon edges: never claim a rectangle merely because its corners fit.
	function covered(coverage, box) {
		const corners = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]];
		for (const [x, y] of corners) {
			if (!coverage.rings.some((r) => !r.hole && pointInRing(x, y, r.coordinates)) || coverage.rings.some((r) => r.hole && pointInRing(x, y, r.coordinates))) return false;
		}
		for (const ring of coverage.rings) {
			for (let i = 1; i < ring.coordinates.length; i++) if (segmentMeetsBox(ring.coordinates[i - 1], ring.coordinates[i], box)) return false;
		}
		return true;
	}
	async function sha256(bytes) {
		return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
	}
	function validateManifest(m) {
		if (m?.schemaVersion !== 1 || m.region !== "finland" || !Number.isFinite(Date.parse(m.snapshotAt)) || m.coverage?.format !== "osm-poly-rings-v1" || !Array.isArray(m.coverage.rings) || !m.coverage.rings.length || !Array.isArray(m.shards) || !m.shards.length || m.shards.length > 10000) throw new LocalDataError("Invalid local OSM manifest");
		if (!m.coverage.rings.some((r) => r.hole === false)) throw new LocalDataError("Missing exterior coverage ring");
		for (const ring of m.coverage.rings) {
			if (typeof ring.hole !== "boolean" || !Array.isArray(ring.coordinates) || ring.coordinates.length < 4 || ring.coordinates.some((p) => !Array.isArray(p) || p.length !== 2 || !boundsValid([...p, ...p])) || JSON.stringify(ring.coordinates[0]) !== JSON.stringify(ring.coordinates.at(-1))) throw new LocalDataError("Invalid coverage ring");
		}
		const files = new Set();
		for (const s of m.shards) {
			if (!/^-?\d+_-?\d+\.ndjson\.gz$/.test(s.file) || files.has(s.file) || !boundsValid(s.bounds) || !/^[a-f0-9]{64}$/.test(s.sha256) || !Number.isSafeInteger(s.bytes) || s.bytes <= 0 || s.bytes > 32 * 1024 * 1024 || !Number.isSafeInteger(s.rawBytes) || s.rawBytes <= 0 || s.rawBytes > 128 * 1024 * 1024 || !Number.isSafeInteger(s.records) || s.records <= 0) throw new LocalDataError("Invalid local OSM shard directory");
			files.add(s.file);
		}
		if (![m.counts?.way, m.counts?.node].every((n) => Number.isSafeInteger(n) && n >= 0) || m.counts.way + m.counts.node !== m.shards.reduce((sum, s) => sum + s.records, 0)) throw new LocalDataError("Invalid snapshot counts");
	}
	function recordBounds(item) {
		if (!["way", "node"].includes(item.type) || !Number.isSafeInteger(item.id) || item.id <= 0 || !item.tags || Object.values(item.tags).some((v) => typeof v !== "string")) throw new LocalDataError("Invalid OSM record");
		const points = item.type === "node" ? [item] : item.geometry;
		if (!Array.isArray(points) || !points.length || (item.type === "way" && (points.length < 2 || !Array.isArray(item.nodes) || item.nodes.length !== points.length || item.nodes.some((id) => !Number.isSafeInteger(id) || id <= 0)))) throw new LocalDataError("Invalid OSM geometry/membership");
		const b = [180, 90, -180, -90];
		for (const p of points) {
			if (!boundsValid([p.lon, p.lat, p.lon, p.lat])) throw new LocalDataError("Invalid OSM coordinate");
			b[0] = Math.min(b[0], p.lon); b[1] = Math.min(b[1], p.lat); b[2] = Math.max(b[2], p.lon); b[3] = Math.max(b[3], p.lat);
		}
		return b;
	}
	async function scan(bytes, entry, visit, signal) {
		const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
		const decoder = new TextDecoder("utf-8", { fatal: true });
		let pending = "", rawBytes = 0, records = 0;
		const counts = { way: 0, node: 0 };
		try {
			while (true) {
				signal?.throwIfAborted();
				const { value, done } = await reader.read();
				if (done) break;
				rawBytes += value.byteLength;
				if (rawBytes > entry.rawBytes) throw new LocalDataError("Decompressed shard exceeds declared size");
				pending += decoder.decode(value, { stream: true });
				let end;
				while ((end = pending.indexOf("\n")) !== -1) {
					const line = pending.slice(0, end); pending = pending.slice(end + 1);
					if (line.length > 4 * 1024 * 1024) throw new LocalDataError("OSM record exceeds memory limit");
					const item = JSON.parse(line), b = recordBounds(item);
					if (b[0] < entry.bounds[0] || b[1] < entry.bounds[1] || b[2] > entry.bounds[2] || b[3] > entry.bounds[3]) throw new LocalDataError("Geometry outside shard index");
					counts[item.type]++; records++;
					visit(item, b, line.length);
				}
				if (pending.length > 4 * 1024 * 1024) throw new LocalDataError("OSM record exceeds memory limit");
			}
			pending += decoder.decode();
			if (pending || rawBytes !== entry.rawBytes || records !== entry.records) throw new LocalDataError("Incomplete local OSM shard");
		}
		finally { await reader.cancel(); reader.releaseLock(); }
		return counts;
	}
	function request(r) {
		return new Promise(function (resolve, reject) { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
	}
	function finished(tx) {
		return new Promise(function (resolve, reject) { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error || new LocalDataError("Snapshot transaction aborted")); });
	}
	function create({ name = "krb-local-osm-v1", factory = globalThis.indexedDB, memoryBytes = 32 * 1024 * 1024, resultBytes = 64 * 1024 * 1024 } = {}) {
		let opening, db, residentBytes = 0, busy = false;
		const memory = new Map();
		const counters = { diskReads: 0, memoryHits: 0, writes: 0 };
		async function open() {
			if (!opening) opening = (async function () {
				if (!factory) throw new LocalDataError("Local snapshots require IndexedDB");
				const r = factory.open(name, 1);
				r.onupgradeneeded = function () { r.result.createObjectStore("meta"); r.result.createObjectStore("parts"); };
				db = await request(r); db.onversionchange = () => db.close();
			})();
			await opening;
		}
		async function get(store, key) { await open(); return request(db.transaction(store).objectStore(store).get(key)); }
		async function write(stores, work) {
			await open();
			const tx = db.transaction(stores, "readwrite"), done = finished(tx);
			try { work(tx); }
			catch (error) { tx.abort(); await Promise.allSettled([done]); throw error; }
			await done;
		}
		async function status() {
			const active = await get("meta", "active");
			return active ? { id: active.id, snapshotAt: active.manifest.snapshotAt, counts: active.manifest.counts, source: active.manifest.source, bytes: active.manifest.shards.reduce((n, s) => n + s.bytes, 0) } : null;
		}
		async function importSnapshot(input, loadShard, { signal, onProgress } = {}) {
			if (busy) throw new LocalDataError("Snapshot import already running in this store");
			busy = true;
			try {
				const manifest = structuredClone(input); validateManifest(manifest);
				const id = await sha256(new TextEncoder().encode(JSON.stringify(manifest)));
				const previous = await get("meta", "active");
				if (previous?.id === id) return { id, unchanged: true };
				await write("meta", (tx) => tx.objectStore("meta").put({ id, pending: true, updatedAt: Date.now() }, ["snapshot", id]));
				const counts = { way: 0, node: 0 }; let completed = 0;
				for (const entry of manifest.shards) {
					signal?.throwIfAborted();
					let part = await get("parts", [id, entry.file]);
					const reused = Boolean(part);
					if (!part) {
						const bytes = await loadShard(entry, signal);
						if (!(bytes instanceof Uint8Array) || bytes.byteLength !== entry.bytes || await sha256(bytes) !== entry.sha256) throw new LocalDataError("Local OSM shard checksum mismatch");
						const found = await scan(bytes, entry, function () {}, signal);
						part = { bytes, counts: found };
						await write(["parts", "meta"], function (tx) {
							tx.objectStore("parts").put(part, [id, entry.file]);
							tx.objectStore("meta").put({ id, pending: true, updatedAt: Date.now() }, ["snapshot", id]);
						}); counters.writes++;
					}
					counts.way += part.counts.way; counts.node += part.counts.node;
					completed++; onProgress?.({ completed, total: manifest.shards.length, reused });
				}
				signal?.throwIfAborted();
				if (counts.way !== manifest.counts.way || counts.node !== manifest.counts.node) throw new LocalDataError("Snapshot feature counts mismatch");
				// Compare-and-swap in one transaction protects competing import contexts.
				await write("meta", function (tx) {
					const store = tx.objectStore("meta"), r = store.get("active");
					r.onsuccess = function () {
						if ((r.result?.id || null) !== (previous?.id || null)) { tx.abort(); return; }
						if (r.result) store.put({ id: r.result.id, pending: false, updatedAt: Date.now() }, ["snapshot", r.result.id]);
						store.put({ id, pending: false, updatedAt: Date.now() }, ["snapshot", id]);
						store.put({ id, manifest }, "active");
					};
				});
				return { id, unchanged: false };
			}
			finally { busy = false; }
		}
		function remember(key, bytes) {
			if (memory.has(key)) residentBytes -= memory.get(key).byteLength;
			memory.delete(key);
			if (bytes.byteLength <= memoryBytes) { memory.set(key, bytes); residentBytes += bytes.byteLength; }
			while (residentBytes > memoryBytes) { const first = memory.keys().next().value; residentBytes -= memory.get(first).byteLength; memory.delete(first); }
		}
		async function query(boxes, { signal } = {}) {
			if (!Array.isArray(boxes) || !boxes.length || boxes.length > 10000 || boxes.some((b) => !boundsValid(b))) throw new LocalDataError("Invalid local OSM query bounds");
			const lease = ["reader", crypto.randomUUID()];
			let active;
			await write("meta", function (tx) {
				const store = tx.objectStore("meta"), r = store.get("active");
				r.onsuccess = function () { active = r.result; if (active) store.put({ id: active.id, expires: Date.now() + 600000 }, lease); };
			});
			if (!active) return { available: false, covered: boxes.map(() => false), elements: [] };
			try {
				const { id, manifest } = active;
				const coverage = boxes.map((b) => covered(manifest.coverage, b));
				const results = new Map(); let size = 0, selected = 0;
				// Spatial directory sorted by western extent; skip files east of every query.
				const east = Math.max(...boxes.map((b) => b[2]));
				for (const entry of [...manifest.shards].sort((a, b) => a.bounds[0] - b.bounds[0])) {
					if (entry.bounds[0] > east) break;
					if (!boxes.some((b) => intersects(entry.bounds, b))) continue;
					signal?.throwIfAborted(); selected++;
					await write("meta", (tx) => tx.objectStore("meta").put({ id, expires: Date.now() + 600000 }, lease));
					const key = `${id}/${entry.file}`;
					let bytes = memory.get(key);
					if (bytes) counters.memoryHits++;
					else {
						bytes = (await get("parts", [id, entry.file]))?.bytes; counters.diskReads++;
						if (!bytes || bytes.byteLength !== entry.bytes || await sha256(bytes) !== entry.sha256) throw new LocalDataError("Local snapshot file missing or corrupt");
					}
					remember(key, bytes);
					await scan(bytes, entry, function (item, bounds, length) {
						if (!boxes.some((b) => intersects(bounds, b))) return;
						const key = `${item.type}/${item.id}`;
						if (!results.has(key)) {
							size += length * 2;
							if (size > resultBytes) throw new LocalDataError("Local query result exceeds budget; request smaller areas");
							results.set(key, item);
						}
					}, signal);
				}
				return { available: true, id, snapshotAt: manifest.snapshotAt, covered: coverage, elements: [...results.values()], shardsRead: selected };
			}
			finally { await write("meta", (tx) => tx.objectStore("meta").delete(lease)); }
		}
		// Reader leases protect a query's immutable generation during concurrent cleanup.
		async function cleanup({ now = Date.now(), inactiveMs = 86400000, pendingMs = 14 * 86400000 } = {}) {
			let removed = 0;
			await write(["meta", "parts"], function (tx) {
				const meta = tx.objectStore("meta"), r = meta.getAll(), keys = meta.getAllKeys(), active = meta.get("active");
				active.onsuccess = function () {
					const protectedIds = new Set([active.result?.id]), candidates = new Set();
					for (let i = 0; i < r.result.length; i++) {
						const key = keys.result[i], value = r.result[i];
						if (Array.isArray(key) && key[0] === "reader") {
							if (value.expires > now) protectedIds.add(value.id); else meta.delete(key);
						}
					}
					for (let i = 0; i < r.result.length; i++) {
						const key = keys.result[i], value = r.result[i];
						if (Array.isArray(key) && key[0] === "snapshot" && !protectedIds.has(value.id) && now - value.updatedAt >= (value.pending ? pendingMs : inactiveMs)) { candidates.add(value.id); meta.delete(key); }
					}
					const cursor = tx.objectStore("parts").openCursor();
					cursor.onsuccess = function () { const c = cursor.result; if (!c) return; if (candidates.has(c.key[0])) { c.delete(); removed++; } c.continue(); };
				};
			});
			memory.clear(); residentBytes = 0; return { removedParts: removed };
		}
		function stats() { return { ...counters, residentBytes, memoryLimit: memoryBytes, resultLimit: resultBytes }; }
		async function close() { await open(); if (busy) throw new LocalDataError("Cannot close during import"); db.close(); opening = undefined; memory.clear(); residentBytes = 0; }
		return { importSnapshot, query, status, cleanup, stats, close };
	}
	globalThis.KrbLocalOsm = { create, covered, LocalDataError };
})();
