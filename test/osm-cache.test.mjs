import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
const source = readFileSync(new URL("../osm-cache.js", import.meta.url), "utf8");
function fixture(options = {}) {
	const context = { indexedDB: new IDBFactory(), TextEncoder, console };
	runInNewContext(source, context);
	return (overrides = {}) => context.KrbOsmCache.create({ ...options, ...overrides });
}
function area(i, text = "example", time = Date.now()) {
	return { key: `60,${20 + i * 0.01},60.001,${20.001 + i * 0.01}`, routeComplete: true, time,
		data: { type: "FeatureCollection", features: [{ type: "Feature", properties: { osmId: `way/${i}`, label: text }, geometry: { type: "LineString", coordinates: [[20, 60], [20.001, 60.001]] } }] } };
}
const key = (entry) => `route:${entry.key}`;

test("90 megabyte-scale areas survive restart; startup loads metadata, hits never rewrite geometry", async function () {
	const create = fixture({ memoryBytes: 2 * 1024 * 1024 });
	let cache = create();
	const entries = Array.from({ length: 90 }, (_, i) => area(i, "x".repeat(1024 * 1024)));
	for (const entry of entries) await cache.put(entry);
	assert.equal(cache.stats().areas, 90);
	assert.ok(cache.stats().residentBytes <= 2 * 1024 * 1024);
	await cache.close();
	cache = create(); await cache.list();
	assert.equal(cache.stats().residentBytes, 0);
	assert.equal(cache.stats().areas, 90);
	for (const entry of entries) {
		const hit = await cache.read(key(entry));
		assert.equal(hit.source, "disk");
		assert.equal(hit.data.features[0].properties.label.length, 1024 * 1024);
	}
	assert.equal(cache.stats().payloadWrites, 0);
	assert.equal(cache.stats().metadataWrites, 90);
	assert.equal(cache.stats().diskHits, 90);
	assert.ok(cache.stats().residentBytes <= 2 * 1024 * 1024);
	assert.equal((await cache.read(key(entries.at(-1)))).source, "memory");
	await cache.close();
});

test("migration keeps unexpired route/display entries and removes legacy only after commit", async function () {
	let stored = { osmHazardsCacheV4: [area(0), { ...area(1), routeComplete: false }, area(2, "expired", Date.now() - 8 * 86400000)] };
	const create = fixture({ storage: { async get() { return stored; }, async remove() { stored = {}; } } });
	const cache = create();
	const entries = await cache.list();
	assert.equal(entries.size, 2);
	assert.equal(entries.has(key(area(0))), true);
	assert.equal(entries.has(area(1).key), true);
	assert.equal(Object.keys(stored).length, 0);
	await cache.close();
	assert.equal((await create().read(key(area(0)))).source, "disk");
});

test("LRU eviction updates metadata only and touching does not extend seven-day freshness", async function () {
	let time = 1000;
	const create = fixture({ maxAreas: 2, now: () => time });
	let cache = create();
	const a = area(0, "a", time++), b = area(1, "b", time++), c = area(2, "c", time++);
	await cache.put(a); await cache.put(b);
	time++; await cache.read(key(a));
	await cache.close(); cache = create();
	time++; await cache.put(c);
	assert.equal(await cache.read(key(b)), undefined);
	assert.ok(await cache.read(key(a)));
	time = a.time + 7 * 86400000;
	assert.equal(await cache.read(key(a)), undefined);
	await cache.close();
});

test("byte budget uses UTF-8 payload size and clearing deletes disk plus RAM", async function () {
	const create = fixture({ diskBytes: 1400 });
	let cache = create();
	await cache.put(area(0, "ä".repeat(300)));
	await cache.put(area(1, "ä".repeat(300)));
	assert.equal(cache.stats().areas, 1);
	assert.ok(cache.stats().bytes <= 1400);
	await cache.clear();
	assert.equal(cache.stats().bytes, 0);
	assert.equal(cache.stats().residentBytes, 0);
	await cache.close(); cache = create();
	assert.equal((await cache.list()).size, 0);
});

test("failed migration preserves legacy storage and queued clear cannot be repopulated", async function () {
	let removed = false;
	const create = fixture({ diskBytes: 1000, storage: { async get() { return { osmHazardsCacheV4: [area(0, "x".repeat(2000))] }; }, async remove() { removed = true; } } });
	const cache = create();
	await cache.list();
	assert.equal(removed, false);
	const writing = cache.put(area(1));
	const clearing = cache.clear();
	await Promise.all([writing, clearing]);
	assert.equal((await cache.list()).size, 0);
	await assert.rejects(cache.put(area(2, "x".repeat(2000))), /budget/);
	assert.equal((await cache.list()).size, 0);
});


test("quota failure evicts once and retries atomically; clone failures cannot leave orphan metadata", async function () {
	const create = fixture();
	const cache = create();
	for (let i = 0; i < 4; i++) await cache.put(area(i));
	const original = IDBObjectStore.prototype.put;
	let failures = 0;
	IDBObjectStore.prototype.put = function (...args) {
		if (this.name === "geometry" && failures++ === 0) throw new DOMException("Disk full", "QuotaExceededError");
		return original.apply(this, args);
	};
	try { await cache.put(area(4)); }
	finally { IDBObjectStore.prototype.put = original; }
	assert.equal(cache.stats().areas, 4);
	assert.equal(await cache.read(key(area(0))), undefined);
	assert.ok(await cache.read(key(area(4))));
	const invalid = area(5);
	invalid.data.uncloneable = function () {};
	await assert.rejects(cache.put(invalid), { name: "DataCloneError" });
	await cache.close();
	const reopened = create();
	assert.equal((await reopened.list()).size, 4);
	assert.equal(await reopened.read(key(invalid)), undefined);
});
