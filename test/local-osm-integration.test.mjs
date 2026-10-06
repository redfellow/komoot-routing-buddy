import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { gzipSync } from "node:zlib";
import { createHash, webcrypto } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
const source = ["local-osm.js", "osm-cache.js", "osm-overrides.js", "hazards.js", "route-check.js"]
	.map((f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8"))
	.join("\n");
const box = [61, 24, 61.01, 24.01];
const way = {
	type: "way",
	id: 1,
	nodes: [2, 3],
	geometry: [
		{ lon: 24, lat: 61 },
		{ lon: 24.005, lat: 61.005 },
	],
	tags: { highway: "path", surface: "dirt", "mtb:scale": "2", width: "0.3" },
};
const node = { type: "node", id: 2, lon: 24, lat: 61, tags: { barrier: "log" } };
async function fixture(elements = [way, node]) {
	let network = 0;
	const context = {
		indexedDB: new IDBFactory(),
		crypto: webcrypto,
		Uint8Array,
		TextEncoder,
		TextDecoder,
		Blob,
		DecompressionStream,
		structuredClone,
		console,
		URL,
		URLSearchParams,
		AbortSignal,
		async fetch() {
			network++;
			throw new Error("Network used");
		},
	};
	runInNewContext(source, context);
	const raw = Buffer.from(elements.map((e) => JSON.stringify(e)).join("\n") + "\n"),
		bytes = new Uint8Array(gzipSync(raw));
	const manifest = {
		schemaVersion: 1,
		region: "finland",
		snapshotAt: "2026-09-30T20:22:42Z",
		counts: { way: 1, node: elements.length - 1 },
		coverage: {
			format: "osm-poly-rings-v1",
			rings: [
				{
					hole: false,
					coordinates: [
						[23, 60],
						[25, 60],
						[25, 62],
						[23, 62],
						[23, 60],
					],
				},
			],
		},
		shards: [
			{
				file: "0_0.ndjson.gz",
				bounds: [23, 60, 25, 62],
				records: elements.length,
				rawBytes: raw.length,
				bytes: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
			},
		],
	};
	const store = context.KrbLocalOsm.create();
	await store.importSnapshot(manifest, async () => bytes);
	return { context, store, network: () => network };
}
test("both map and trail reads use local snapshot with existing converter semantics and no network", async function () {
	const f = await fixture(),
		api = f.context.KrbHazards;
	const map = await api.load(box),
		trail = await api.loadRoute(box);
	assert.equal(map.cacheSource, "local");
	assert.equal(trail.cacheSource, "local");
	assert.equal(JSON.stringify(map.features), JSON.stringify(api.convert([way, node]).features));
	assert.equal(
		JSON.stringify(trail.features),
		JSON.stringify(api.convertRoute([way, node]).features),
	);
	assert.equal(map.features.find((e) => e.properties.osmId === "node/2").properties.icon_log, true);
	assert.equal(f.network(), 0);
	await f.store.close();
});
test("covered empty area is authoritative even if the API cache contains old hazards", async function () {
	const f = await fixture();
	const cached = f.context.KrbOsmCache.create();
	await cached.put({
		key: "60,23,62,25",
		time: Date.now(),
		data: f.context.KrbHazards.convert([way, node]),
	});
	const data = await f.context.KrbHazards.load([61.5, 24.5, 61.51, 24.51]);
	assert.equal(data.features.length, 0);
	assert.equal(data.cacheSource, "local");
	assert.equal(f.network(), 0);
	await cached.close();
	await f.store.close();
});
test("uncovered area falls back to successful API cache, without claiming local coverage", async function () {
	const f = await fixture(),
		cached = f.context.KrbOsmCache.create();
	await cached.put({
		key: "63,26,64,27",
		time: Date.now(),
		data: f.context.KrbHazards.convert([way, node]),
	});
	const data = await f.context.KrbHazards.load([63.1, 26.1, 63.11, 26.11]);
	assert.notEqual(data.cacheSource, "local");
	assert.equal(data.features.length, 2);
	assert.equal(f.network(), 0);
	await cached.close();
	await f.store.close();
});
test("whole-route local lookup bypasses per-area downloads and preserves warning analysis", async function () {
	const f = await fixture(),
		checker = f.context.KrbRouteCheck,
		api = f.context.KrbHazards;
	const route = {
		type: "Feature",
		geometry: { type: "LineString", coordinates: way.geometry.map((p) => [p.lon, p.lat]) },
	};
	let areas = 0,
		report;
	const features = await checker.collectWithRetry(
		route,
		async function () {
			areas++;
			throw new Error("Per-area request should not run");
		},
		{
			localLoad: async (boxes) => ({ data: await api.loadLocalRoute(boxes) }),
			progress(p) {
				report = p;
			},
		},
	);
	assert.equal(areas, 0);
	assert.equal(report.completed, report.total);
	assert.equal(report.downloaded, 0);
	assert.equal(
		JSON.stringify(checker.analyse(route, features, {})),
		JSON.stringify(checker.analyse(route, api.convertRoute([way, node]).features, {})),
	);
	await f.store.close();
});
test("partial local route never claims all areas covered", async function () {
	const f = await fixture();
	assert.equal(await f.context.KrbHazards.loadLocalRoute([box, [63, 26, 63.01, 26.01]]), undefined);
	const prefix = await f.context.KrbHazards.loadRoute(box, [[63, 26, 63.01, 26.01]]);
	assert.equal(prefix.coveredAreas, 1);
	assert.equal(prefix.cacheSource, "local");
	assert.equal(f.network(), 0);
	await f.store.close();
});
test("optional local fast-path failure continues through normal area checking", async function () {
	const f = await fixture();
	const route = {
		type: "Feature",
		geometry: {
			type: "LineString",
			coordinates: [
				[24, 61],
				[24.001, 61],
			],
		},
	};
	let calls = 0;
	const features = await f.context.KrbRouteCheck.collectWithRetry(
		route,
		async function () {
			calls++;
			return { data: { type: "FeatureCollection", features: [], cacheSource: "cache" } };
		},
		{
			localLoad() {
				throw new Error("Local storage not available");
			},
		},
	);
	assert.ok(calls > 0);
	assert.equal(features.length, 0);
	await f.store.close();
});
test("corrupt local storage falls back to API cache rather than returning empty success", async function () {
	const f = await fixture(),
		cached = f.context.KrbOsmCache.create();
	await cached.put({
		key: "61,24,61.01,24.01",
		time: Date.now(),
		data: f.context.KrbHazards.convert([way, node]),
	});
	const opening = f.context.indexedDB.open("krb-local-osm-v1");
	const db = await new Promise(function (resolve, reject) {
		opening.onsuccess = () => resolve(opening.result);
		opening.onerror = () => reject(opening.error);
	});
	await new Promise(function (resolve, reject) {
		const tx = db.transaction("parts", "readwrite");
		tx.objectStore("parts").clear();
		tx.oncomplete = resolve;
		tx.onabort = () => reject(tx.error);
	});
	const data = await f.context.KrbHazards.load(box);
	assert.notEqual(data.cacheSource, "local");
	assert.equal(data.features.length, 2);
	assert.equal(f.network(), 0);
	db.close();
	await cached.close();
	await f.store.close();
});

test("successful empty manual route refresh removes old local hazards and survives repeated checks", async function () {
	const f = await fixture(),
		api = f.context.KrbHazards;
	let calls = 0;
	f.context.fetch = async function () {
		calls++;
		return { ok: true, body: new Blob([JSON.stringify({ elements: [] })]).stream() };
	};
	const refreshed = await api.loadRoute(box, [], { refresh: true });
	assert.equal(refreshed.cacheSource, "network");
	assert.equal(calls, 1);
	const again = await api.loadLocalRoute([box]);
	assert.equal(again.features.length, 0);
	assert.ok(again.refreshedAt);
	assert.equal((await api.load(box)).features.length, 0);
	assert.equal(calls, 1);
	await f.store.close();
});

test("failed manual refresh never shadows valid regional data", async function () {
	const f = await fixture(),
		api = f.context.KrbHazards;
	await assert.rejects(api.loadRoute(box, [], { refresh: true }), /Network used/);
	const local = await api.loadLocalRoute([box]);
	assert.equal(local.features.length, 2);
	assert.equal(local.refreshedAt, undefined);
	await f.store.close();
});

test("route overrides expire after seven days and are superseded by later source snapshots", async function () {
	const f = await fixture(),
		overrides = f.context.KrbOsmOverrides.create();
	await overrides.put(
		box,
		{ type: "FeatureCollection", trailSchema: 1, features: [] },
		Date.now() - 8 * 86400000,
	);
	assert.equal((await overrides.read([box], "2026-09-30T00:00:00Z")).length, 0);
	const refreshed = Date.now();
	await overrides.put(box, { type: "FeatureCollection", trailSchema: 1, features: [] }, refreshed);
	assert.equal((await overrides.read([box], new Date(refreshed - 1000).toISOString())).length, 1);
	assert.equal((await overrides.read([box], new Date(refreshed + 1000).toISOString())).length, 0);
	await f.store.close();
});

test("empty partial overrides remove only covered geometry and preserve distant hazards", async function () {
	const f = await fixture(),
		overrides = f.context.KrbOsmOverrides.create();
	const data = f.context.KrbHazards.convertRoute([way, node]);
	const clipped = overrides.apply(data, [
		{ bounds: [61, 24, 61.002, 24.002], time: Date.now(), data: { features: [] } },
	]);
	assert.equal(clipped.features.filter((f) => f.geometry.type === "Point").length, 0);
	const remaining = clipped.features.find((f) => f.geometry.type === "LineString");
	assert.ok(remaining.geometry.coordinates[0][0] >= 24.002);
	assert.equal(remaining.geometry.coordinates.at(-1)[0], 24.005);
	await f.store.close();
});

test("partial refresh coverage also shadows ordinary cached data outside Finland coverage", async function () {
	const f = await fixture(),
		api = f.context.KrbHazards,
		overrides = f.context.KrbOsmOverrides.create(),
		cached = f.context.KrbOsmCache.create();
	const outside = {
		...way,
		geometry: [
			{ lon: 26, lat: 63 },
			{ lon: 26.01, lat: 63.01 },
		],
	};
	await cached.put({
		key: "63,26,63.02,26.02",
		time: Date.now(),
		data: api.convertRoute([outside]),
		routeComplete: true,
	});
	await overrides.put([63, 26, 63.005, 26.005], {
		type: "FeatureCollection",
		trailSchema: 1,
		features: [],
	});
	const result = await api.loadRoute([63, 26, 63.02, 26.02]);
	assert.equal(result.features.length, 1);
	assert.ok(result.features[0].geometry.coordinates[0][0] >= 26.005);
	assert.ok(result.refreshedAt);
	assert.equal(f.network(), 0);
	await cached.close();
	await f.store.close();
});
