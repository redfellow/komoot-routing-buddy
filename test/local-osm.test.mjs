import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { gzipSync } from "node:zlib";
import { createHash, webcrypto } from "node:crypto";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
const source = readFileSync(new URL("../local-osm.js", import.meta.url), "utf8");
const coverage = { format: "osm-poly-rings-v1", rings: [{ hole: false, coordinates: [[20, 60], [30, 60], [30, 70], [20, 70], [20, 60]] }] };
const way = (id, lon = 24) => ({ type: "way", id, nodes: [1, 2], geometry: [{ lon, lat: 61 }, { lon: lon + 0.01, lat: 61.01 }], tags: { highway: "path", "mtb:scale": "1" } });
function dataset(items = [way(1), way(2, 25)]) {
	const files = new Map();
	const shards = items.map(function (item, i) {
		const raw = Buffer.from(JSON.stringify(item) + "\n"), bytes = new Uint8Array(gzipSync(raw));
		const file = `${i}_0.ndjson.gz`; files.set(file, bytes);
		return { file, bytes: bytes.length, rawBytes: raw.length, records: 1, sha256: createHash("sha256").update(bytes).digest("hex"), bounds: [20, 60, 30, 70] };
	});
	return { manifest: { schemaVersion: 1, region: "finland", snapshotAt: "2026-09-30T20:22:42Z", coverage, counts: { way: items.length, node: 0 }, shards }, load: async (entry) => files.get(entry.file), files };
}
function fixture(options = {}) {
	const context = { indexedDB: new IDBFactory(), crypto: webcrypto, Uint8Array, Blob, DecompressionStream, TextDecoder, TextEncoder, structuredClone, console };
	runInNewContext(source, context);
	return { api: context.KrbLocalOsm, create: (extra = {}) => context.KrbLocalOsm.create({ ...options, ...extra }) };
}
const box = [23.9, 60.9, 24.2, 61.2];
test("persists full geometry, queries covered empty areas and keeps snapshots separate from API cache", async function () {
	const { create } = fixture(), data = dataset(); let store = create();
	assert.equal((await store.query([box])).available, false);
	await store.importSnapshot(data.manifest, data.load); await store.close(); store = create();
	const result = await store.query([box]);
	assert.equal(result.covered[0], true); assert.equal(result.elements.length, 1); assert.equal(result.elements[0].id, 1);
	assert.deepEqual(Array.from(result.elements[0].nodes), [1, 2]);
	const empty = await store.query([[27, 65, 28, 66]]);
	assert.equal(empty.covered[0], true); assert.equal(empty.elements.length, 0);
	assert.equal((await store.query([[0, 0, 1, 1]])).covered[0], false);
	await store.close();
});
test("failed replacement leaves old snapshot active and resumes validated files after restart", async function () {
	const { create } = fixture(); let store = create(); const old = dataset([way(10)]), next = dataset([way(20), way(21)]);
	await store.importSnapshot(old.manifest, old.load);
	await assert.rejects(store.importSnapshot(next.manifest, async function (entry) {
		if (entry.file === next.manifest.shards[1].file) throw new Error("offline"); return next.load(entry);
	}), /offline/);
	assert.equal((await store.query([box])).elements[0].id, 10);
	await store.close(); store = create(); const downloaded = [];
	await store.importSnapshot(next.manifest, async function (entry) { downloaded.push(entry.file); return next.load(entry); });
	assert.deepEqual(downloaded, [next.manifest.shards[1].file]);
	assert.equal((await store.query([box])).elements[0].id, 20);
	await store.close();
});
test("checksum and raw-size failures cannot activate partial snapshot", async function () {
	const { create } = fixture(), store = create(), data = dataset();
	await assert.rejects(store.importSnapshot(data.manifest, async () => new Uint8Array([1])), /checksum/);
	assert.equal(await store.status(), null);
	data.manifest.shards[0].rawBytes = 1;
	await assert.rejects(store.importSnapshot(data.manifest, data.load), /declared size/);
	assert.equal(await store.status(), null); await store.close();
});
test("aborted imports checkpoint completed files but never publish", async function () {
	const { create } = fixture(), store = create(), data = dataset(), control = new AbortController();
	await assert.rejects(store.importSnapshot(data.manifest, data.load, { signal: control.signal, onProgress() { control.abort(); } }), { name: "AbortError" });
	assert.equal(await store.status(), null);
	let calls = 0; await store.importSnapshot(data.manifest, async function (entry) { calls++; return data.load(entry); });
	assert.equal(calls, 1); await store.close();
});
test("coverage rejects holes and concave boundaries even if all corners are inside", function () {
	const { api } = fixture(); const c = structuredClone(coverage);
	c.rings.push({ hole: true, coordinates: [[24, 64], [25, 64], [25, 65], [24, 65], [24, 64]] });
	assert.equal(api.covered(c, [23, 63, 26, 66]), false);
	assert.equal(api.covered(c, box), true);
	const concave = { rings: [{ hole: false, coordinates: [[20, 60], [30, 60], [30, 70], [26, 70], [26, 63], [24, 63], [24, 70], [20, 70], [20, 60]] }] };
	assert.equal(api.covered(concave, [23, 62, 27, 68]), false);
});
test("budgets prevent retaining huge caches and returning unbounded geometry", async function () {
	const { create } = fixture({ memoryBytes: 1, resultBytes: 1 }), store = create(), data = dataset();
	await store.importSnapshot(data.manifest, data.load);
	await assert.rejects(store.query([box]), /result exceeds budget/);
	assert.equal(store.stats().residentBytes, 0); await store.close();
});
test("overlapping queries deduplicate records; hot cache stays within byte budget", async function () {
	const { create } = fixture({ memoryBytes: 1024 }), store = create(), data = dataset();
	await store.importSnapshot(data.manifest, data.load);
	assert.equal((await store.query([box, box])).elements.length, 1);
	await store.query([box]); assert.equal(store.stats().memoryHits, 2); assert.ok(store.stats().residentBytes <= 1024); await store.close();
});
test("malformed manifests and filenames are rejected before acquisition", async function () {
	const { create } = fixture(), store = create(), data = dataset(); data.manifest.shards[0].file = "../secret";
	await assert.rejects(store.importSnapshot(data.manifest, data.load), /directory/); await store.close();
});

test("readers keep seeing old snapshot during import; competing imports cannot overwrite a newer activation", async function () {
	const { create } = fixture(), first = create(), second = create();
	const old = dataset([way(10)]), a = dataset([way(20)]), b = dataset([way(30)]);
	await first.importSnapshot(old.manifest, old.load);
	let unblock, started;
	const gate = new Promise(function (resolve) { unblock = resolve; });
	const reached = new Promise(function (resolve) { started = resolve; });
	const importing = first.importSnapshot(a.manifest, async function (entry) { started(); await gate; return a.load(entry); });
	await reached;
	assert.equal((await second.query([box])).elements[0].id, 10);
	await second.importSnapshot(b.manifest, b.load);
	unblock(); await assert.rejects(importing, /transaction aborted/);
	assert.equal((await first.query([box])).elements[0].id, 30);
	await first.close(); await second.close();
});

test("queries retain hazard-node IDs and full crossing-way geometry", async function () {
	const { create } = fixture(), store = create();
	const crossing = way(10, 23); crossing.geometry[1].lon = 25;
	const node = { type: "node", id: 1, lon: 23, lat: 61, tags: { barrier: "log" } };
	const data = dataset([crossing, node]); data.manifest.counts = { way: 1, node: 1 };
	await store.importSnapshot(data.manifest, data.load);
	const result = await store.query([[22.9, 60.9, 23.1, 61.2], [24.9, 60.9, 25.1, 61.2]]);
	assert.equal(result.elements.length, 2);
	assert.equal(result.elements.find((e) => e.type === "node").tags.barrier, "log");
	assert.equal(result.elements.find((e) => e.type === "way").geometry[1].lon, 25);
	await store.close();
});


test("quota failure cannot publish replacement or discard the active snapshot", async function () {
	const { create } = fixture(), store = create(), old = dataset([way(10)]), next = dataset([way(20)]);
	await store.importSnapshot(old.manifest, old.load);
	const put = IDBObjectStore.prototype.put;
	try {
		IDBObjectStore.prototype.put = function (...args) {
			if (this.name === "parts") throw new DOMException("Full disk", "QuotaExceededError");
			return put.apply(this, args);
		};
		await assert.rejects(store.importSnapshot(next.manifest, next.load), { name: "QuotaExceededError" });
	}
	finally { IDBObjectStore.prototype.put = put; }
	assert.equal((await store.query([box])).elements[0].id, 10); await store.close();
});
