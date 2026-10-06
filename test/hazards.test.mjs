import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { IDBFactory } from "fake-indexeddb";
const source =
	readFileSync(new URL("../osm-cache.js", import.meta.url), "utf8") +
	readFileSync(new URL("../hazards.js", import.meta.url), "utf8");
function initialise(context) {
	context.indexedDB ||= new IDBFactory();
	context.TextEncoder = TextEncoder;
	runInNewContext(source, context);
}
function setup(fetch) {
	const context = { fetch, URL, URLSearchParams, AbortSignal, TextDecoder };
	initialise(context);
	return context.KrbHazards;
}
const way = {
	type: "way",
	id: 1,
	nodes: [2],
	tags: { "mtb:scale": "1", obstacle: "vegetation", width: "0.8" },
	geometry: [
		{ lat: 61, lon: 23 },
		{ lat: 61.001, lon: 23.001 },
	],
};

test("OSM conditions preserve geometry, physical width and node membership without guessing hiking levels", function () {
	const api = setup();
	const result = api.convert([
		way,
		way,
		{ ...way, id: 3, tags: { sac_scale: "hiking", obstacle: "vegetation" } },
		{ type: "node", id: 2, lat: 61, lon: 23, tags: { barrier: "log" } },
		{ type: "node", id: 9, lat: 61, lon: 23, tags: { barrier: "log" } },
	]);
	assert.equal(result.features.length, 2);
	assert.equal(result.features[0].geometry.coordinates[0][0], 23);
	assert.match(result.features[0].properties.label, /Width: 0.8 m/);
	assert.equal(result.features[1].properties.osmId, "node/2");
	assert.equal(api.convert([{ ...way, geometry: [null, {}] }]).features.length, 0);
	assert.equal(
		api.convert([
			{
				...way,
				tags: { "mtb:scale": "0", obstacle: "no", surface: "dirt", trail_visibility: "bad" },
			},
		]).features.length,
		0,
	);
});

test("hazard queries validate bounds and cache successful responses", async function () {
	let calls = 0;
	const api = setup(async function (url, options) {
		calls++;
		assert.equal(url, "https://overpass.private.coffee/api/interpreter");
		assert.match(options.body.get("data"), /mtb:scale/);
		assert.match(options.headers["User-Agent"], /^KomootRoutingBuddy\/.*github.com\/redfellow/);
		assert.equal(options.headers.Accept, "application/json");
		return new Response(JSON.stringify({ elements: [way] }));
	});
	await assert.rejects(api.load([0, 0, 90, 180]), /Zoom in/);
	await assert.rejects(api.load([0, NaN, 1, 1]), /Invalid/);
	assert.equal(calls, 0);
	const a = await api.load([61, 23, 61.01, 23.01]);
	const b = await api.load([61, 23, 61.01, 23.01]);
	assert.equal(a, b);
	assert.equal(calls, 1);
});

test("server failures back off and incomplete responses are not treated as empty coverage", async function () {
	let calls = 0;
	const api = setup(async function () {
		calls++;
		return new Response(JSON.stringify({ remark: "timeout", elements: [] }));
	});
	await assert.rejects(api.load([61, 23, 61.01, 23.01]), /incomplete/);
	await assert.rejects(api.load([61, 23, 61.01, 23.01]), /incomplete/);
	assert.equal(calls, 3);
});

test("hazards and remembered layers default on without replacing saved opt-outs", async function () {
	let saved = {};
	const context = {
		KrbBrowser: {
			storage: {
				sync: {
					async get() {
						return saved;
					},
				},
			},
		},
	};
	runInNewContext(readFileSync(new URL("../settings.js", import.meta.url), "utf8"), context);
	let options = await context.KrbSettings.getOptions();
	assert.equal(options.showHazards, true);
	assert.equal(options.rememberLayers, true);
	saved = { trailOptions: { showHazards: false, rememberLayers: false } };
	options = await context.KrbSettings.getOptions();
	assert.equal(options.showHazards, false);
	assert.equal(options.rememberLayers, false);
});

test("identification rule is installed once and scoped to this extension and endpoint", async function () {
	const calls = [];
	const context = {
		URL,
		KrbBrowser: {
			runtime: {
				getManifest() {
					return { version: "1.2.0" };
				},
				getURL() {
					return "chrome-extension://test-extension/";
				},
			},
			declarativeNetRequest: {
				async updateDynamicRules(rule) {
					calls.push(rule);
				},
			},
		},
	};
	initialise(context);
	await Promise.all([context.KrbHazards.identifyRequests(), context.KrbHazards.identifyRequests()]);
	assert.equal(calls.length, 1);
	const rule = calls[0].addRules[0];
	assert.equal(rule.condition.urlFilter, "|https://overpass.private.coffee/api/interpreter|");
	assert.deepEqual(Array.from(rule.condition.initiatorDomains), ["test-extension"]);
	assert.deepEqual(Array.from(rule.condition.requestMethods), ["post"]);
	assert.match(rule.action.requestHeaders[0].value, /^KomootRoutingBuddy\/1.2.0/);
});

test("persistent cache survives background restarts and expires after 7 days", async function () {
	let stored = {};
	const indexedDB = new IDBFactory();
	let now = 1000000;
	let calls = 0;
	function restart() {
		const context = {
			indexedDB,
			console,
			URL,
			URLSearchParams,
			AbortSignal,
			TextDecoder,
			Date: { now: () => now },
			KrbBrowser: {
				storage: {
					local: {
						async get() {
							return structuredClone(stored);
						},
						async set(value) {
							stored = structuredClone(value);
						},
					},
				},
			},
			async fetch() {
				calls++;
				return new Response(JSON.stringify({ elements: [way] }));
			},
		};
		initialise(context);
		return context.KrbHazards;
	}
	const bounds = [61, 23, 61.01, 23.01];
	await restart().load(bounds);
	assert.equal(calls, 1);
	now += (7 * 24 * 60 - 1) * 60000;
	await restart().load(bounds);
	assert.equal(calls, 1);
	now += 60001;
	await restart().load(bounds);
	assert.equal(calls, 2);
});

test("failed requests are not persisted and retain HTTP throttle status", async function () {
	const writes = [];
	const context = {
		console,
		URL,
		URLSearchParams,
		AbortSignal,
		TextDecoder,
		KrbBrowser: {
			storage: {
				local: {
					async get() {
						return {};
					},
					async set(value) {
						writes.push(value);
					},
				},
			},
		},
		async fetch() {
			return new Response("unavailable", { status: 429 });
		},
	};
	initialise(context);
	for (let i = 0; i < 2; i++) {
		await assert.rejects(
			context.KrbHazards.load([61, 23, 61.01, 23.01]),
			(error) => error.status === 429 && error.retryMs > 0,
		);
	}
	assert.equal(writes.length, 0);
});

test("counts distinguish hazards from ordinary width data and deduplicate overlapping categories", function () {
	const result = setup().convert([
		way,
		way,
		{ ...way, id: 2, tags: { "mtb:scale": "0", surface: "mud", width: "0.5" } },
		{ ...way, id: 3, tags: { "mtb:scale": "0", width: "3" } },
		{ ...way, id: 4, tags: { "mtb:scale": "0", width: "0" } },
	]);
	assert.equal(result.features.length, 4);
	assert.equal(result.counts.total, 2);
	assert.equal(result.counts.mud, 1);
	assert.equal(result.counts.vegetation, 1);
	assert.equal(result.counts.narrow, 2);
});

test("expanded cache covers nearby pans and zooms without hiding uncovered areas", async function () {
	let calls = 0;
	const api = setup(async function () {
		calls++;
		return new Response(JSON.stringify({ elements: [] }));
	});
	await api.load([61, 23, 61.01, 23.01]);
	await api.load([61.001, 23.001, 61.009, 23.009]);
	await api.load([61.001, 23.001, 61.011, 23.011]);
	assert.equal(calls, 1);
	await api.load([61.02, 23.02, 61.03, 23.03]);
	assert.equal(calls, 2);
	const nearLimit = [61, 23, 61.04, 23.1];
	assert.doesNotThrow(() => api.boundsKey(api.expandedBounds(nearLimit)));
});

test("providers are sequential, have independent cooldowns, and honour Retry-After", async function () {
	let now = 1000000;
	let inFlight = 0;
	const calls = [];
	const context = {
		URL,
		URLSearchParams,
		AbortSignal,
		TextDecoder,
		Date: { now: () => now, parse: Date.parse },
		async fetch(url) {
			assert.equal(inFlight, 0);
			inFlight++;
			calls.push(url);
			await Promise.resolve();
			inFlight--;
			if (url.includes("private.coffee"))
				return new Response("busy", { status: 429, headers: { "Retry-After": "60" } });
			if (url.includes("mail.ru")) return new Response("busy", { status: 504 });
			return new Response(JSON.stringify({ elements: [] }));
		},
	};
	initialise(context);
	const api = context.KrbHazards;
	await api.load([61, 23, 61.01, 23.01]);
	assert.deepEqual(
		calls.map((url) => new URL(url).hostname),
		["overpass.private.coffee", "maps.mail.ru", "overpass-api.de"],
	);
	now += 31000;
	calls.length = 0;
	await api.load([62, 23, 62.01, 23.01]);
	assert.deepEqual(
		calls.map((url) => new URL(url).hostname),
		["maps.mail.ru", "overpass-api.de"],
	);
	now += 31000;
	calls.length = 0;
	await api.load([63, 23, 63.01, 23.01]);
	assert.equal(new URL(calls[0]).hostname, "overpass.private.coffee");
});

test("invalid queries do not fall through providers; exhausted providers are not hammered", async function () {
	let calls = 0;
	const invalid = setup(async function () {
		calls++;
		return new Response("bad query", { status: 400 });
	});
	await assert.rejects(invalid.load([61, 23, 61.01, 23.01]), (error) => error.status === 400);
	assert.equal(calls, 1);
	calls = 0;
	const down = setup(async function () {
		calls++;
		return new Response("busy", { status: 504 });
	});
	await assert.rejects(
		down.load([61, 23, 61.01, 23.01]),
		(error) => error.exhausted && error.retryMs > 0,
	);
	await assert.rejects(down.load([62, 23, 62.01, 23.01]), (error) => error.exhausted);
	assert.equal(calls, 3);
});

test("cached aggregate totals are recalculated from distinct feature flags", async function () {
	const data = setup().convert([way, { ...way, id: 2, tags: { "mtb:scale": "0", width: "0.5" } }]);
	data.counts.total = 0;
	const context = {
		console,
		KrbBrowser: {
			storage: {
				local: {
					async get() {
						return { osmHazardsCacheV4: [{ key: "61,23,61.02,23.02", time: Date.now(), data }] };
					},
					async set() {},
				},
			},
		},
		fetch() {
			throw new Error("Unexpected network request");
		},
	};
	initialise(context);
	const result = await context.KrbHazards.load([61, 23, 61.01, 23.01]);
	assert.equal(result.counts.total, 2);
	assert.equal(result.counts.narrow, 2);
	assert.equal(result.counts.vegetation, 1);
});

test("compact width labels belong only to rated trails and retain full hover details", function () {
	const result = setup().convert([
		{ ...way, id: 10, tags: { "mtb:scale": "0", width: "50 cm" } },
		{ ...way, id: 11, tags: { width: "3" } },
		{ ...way, id: 12, tags: { "mtb:scale": "6", width: "3" } },
		{ ...way, id: 13, tags: { "mtb:scale": "5", est_width: "0.5" } },
		{ type: "node", id: 2, lat: 61, lon: 23, tags: { barrier: "gate", width: "1" } },
	]);
	assert.equal(result.features.length, 3);
	assert.equal(result.features[0].properties.widthLabel, "0.5m");
	assert.equal(result.features[0].properties.trailRating, "S0");
	assert.equal(result.features[1].properties.widthLabel, "≈0.5m");
	assert.equal(result.features[2].properties.widthLabel, "");
	assert.match(result.features[2].properties.label, /barrier: gate/);
});

test("specific icons suppress the generic warning and have category-only tooltips", function () {
	const cases = [
		[{ obstacle: "vegetation", width: "0.5" }, ["vegetation", "narrow"]],
		[{ obstacle: "narrow" }, []],
		[{ obstacle: "log" }, ["log"]],
		[{ surface: "mud" }, ["mud"]],
		[{ obstacle: "rock" }, ["other"]],
		[{ obstacle: "vegetation;log;rock", surface: "mud" }, ["mud", "vegetation", "log"]],
	];
	for (const [tags, expected] of cases) {
		const p = setup().convert([{ ...way, tags: { "mtb:scale": "1", ...tags } }]).features[0]
			.properties;
		assert.deepEqual(
			["mud", "vegetation", "narrow", "log", "other"].filter((key) => p[`icon_${key}`]),
			expected,
		);
		if (p.icon_vegetation) assert.doesNotMatch(p.tip_vegetation, /Width|log/);
		if (p.icon_narrow) assert.doesNotMatch(p.tip_narrow, /vegetation/);
	}
});

test("narrow icons require a positive measured width at most half a metre", function () {
	for (const [width, expected] of [
		["0.5", true],
		["50 cm", true],
		["0.504", false],
		["0.51", false],
		["0.8", false],
		["0", false],
		[undefined, false],
	]) {
		const p = setup().convert([{ ...way, tags: { "mtb:scale": "1", obstacle: "narrow", width } }])
			.features[0].properties;
		assert.equal(p.icon_narrow, expected);
		assert.equal(p.icon_other, false);
	}
});

test("clearing OSM removes persistent and memory results and forces a fresh request", async function () {
	let stored = {};
	let calls = 0;
	const context = {
		console,
		URL,
		URLSearchParams,
		AbortSignal,
		TextDecoder,
		KrbBrowser: {
			storage: {
				local: {
					async get() {
						return structuredClone(stored);
					},
					async set(value) {
						stored = structuredClone(value);
					},
				},
			},
		},
		async fetch() {
			calls++;
			return new Response(JSON.stringify({ elements: [way] }));
		},
	};
	initialise(context);
	const api = context.KrbHazards;
	const bounds = [61, 23, 61.01, 23.01];
	await api.load(bounds);
	await api.load(bounds);
	assert.equal(calls, 1);
	await api.clearCache();
	assert.equal(api.cacheStats().areas, 0);
	await api.load(bounds);
	assert.equal(calls, 2);
});

test("adjacent preloaded areas satisfy a viewport without a new request", async function () {
	const data = setup().convert([way]);
	const saved = [
		{ key: "61,23,61.01,23.01", time: Date.now(), data },
		{ key: "61,23.01,61.01,23.02", time: Date.now(), data },
	];
	const context = {
		console,
		KrbBrowser: {
			storage: {
				local: {
					async get() {
						return { osmHazardsCacheV4: saved };
					},
					async set() {},
				},
			},
		},
	};
	initialise(context);
	const result = await context.KrbHazards.load([61.001, 23.005, 61.009, 23.015]);
	assert.equal(result.features.length, data.features.length);
	assert.equal(result.counts.total, data.counts.total);
});

test("barrier log uses the wood icon instead of a generic warning", function () {
	const result = setup().convert([
		way,
		{ type: "node", id: 2, lat: 61, lon: 23, tags: { barrier: "log" } },
	]);
	const p = result.features.find((f) => f.geometry.type === "Point").properties;
	assert.equal(p.icon_log, true);
	assert.equal(p.icon_other, false);
	assert.equal(p.tip_log, "Log / fallen tree");
});

test("route conversion retains rating-only and unrated trails with obstacle membership", function () {
	const api = setup();
	const rated = { ...way, tags: { highway: "path", "mtb:scale": "2+", bridge: "yes", layer: "1" } };
	const unrated = { ...way, id: 3, tags: { highway: "track", est_width: "30 cm" } };
	const obstacle = { type: "node", id: 2, lat: 61, lon: 23, tags: { barrier: "log" } };
	const result = api.convertRoute([rated, rated, unrated, obstacle, { ...obstacle, id: 99 }]);
	assert.equal(result.features.length, 3);
	const [a, b, node] = result.features;
	assert.equal(a.properties.trailRating, "S2+");
	assert.equal(a.properties.label, "");
	assert.equal(a.properties.bridge, "yes");
	assert.equal(a.properties.layer, "1");
	assert.equal("nodeIds" in a.properties, false); // Membership is retained on obstacles, not every way.
	assert.equal(b.properties.trailRating, "");
	assert.equal(b.properties.widthMetres, 0.3);
	assert.equal(b.properties.widthEstimated, true);
	assert.equal(node.properties.parentWayIds.join(","), "way/1,way/3");
	assert.equal(node.properties.log, true);
	assert.equal(api.convert([rated]).features.length, 0);
});

test("route conversion excludes unsupported ways and orphan obstacles", function () {
	const api = setup();
	const invalid = { ...way, tags: { highway: "path" }, geometry: [null, {}] };
	const area = { ...way, tags: { highway: "path", area: "yes" } };
	const road = { ...way, tags: { highway: "motorway" } };
	const node = { type: "node", id: 2, lat: 61, lon: 23, tags: { barrier: "log" } };
	assert.equal(api.convertRoute([invalid, area, road, node]).features.length, 0);
});

test("route queries upgrade old cache coverage and complete data also serves the map", async function () {
	let calls = 0;
	const api = setup(async function (url, options) {
		calls++;
		if (calls === 2) assert.doesNotMatch(options.body.get("data"), /\["mtb:scale"~/);
		return new Response(
			JSON.stringify({
				elements: [
					{ ...way, tags: { highway: "path", "mtb:scale": "3" } },
					{ ...way, id: 5, tags: { highway: "track", width: "0.3" } },
				],
			}),
		);
	});
	const bounds = [61, 23, 61.01, 23.01];
	assert.equal((await api.load(bounds)).features.length, 0);
	assert.equal((await api.loadRoute(bounds)).features.length, 2);
	await api.loadRoute(bounds);
	assert.equal(calls, 2);
	assert.equal((await api.load(bounds)).features.length, 0);
	assert.equal(calls, 2);
});

test("route areas persist across restart without the former 128-area cap", async function () {
	const indexedDB = new IDBFactory();
	let calls = 0;
	const bounds = (i) => [60, 20 + i * 0.03, 60.001, 20.001 + i * 0.03];
	function restart() {
		const context = {
			indexedDB,
			URL,
			URLSearchParams,
			AbortSignal,
			TextDecoder,
			async fetch() {
				calls++;
				return new Response(JSON.stringify({ elements: [] }));
			},
		};
		initialise(context);
		return context.KrbHazards;
	}
	let api = restart();
	for (let i = 0; i < 130; i++) await api.loadRoute(bounds(i));
	api = restart();
	for (let i = 0; i < 130; i++) await api.loadRoute(bounds(i));
	assert.equal(calls, 130);
	assert.equal(api.cacheStats().areas, 130);
	assert.equal(api.cacheStats().payloadWrites, 0);
});

test("map conversion keeps obstacle nodes on rated ways without way-level hazards", function () {
	const result = setup().convert([
		{ ...way, tags: { "mtb:scale": "1" } },
		{ type: "node", id: 2, lat: 61, lon: 23, tags: { barrier: "log" } },
	]);
	assert.equal(result.features.length, 1);
	assert.equal(result.features[0].properties.osmId, "node/2");
	assert.equal(result.features[0].properties.icon_log, true);
});

test("wire query crops geometry and obstacle nodes and projects only required tags", function () {
	const api = setup(),
		box = "61,23,61.01,23.01";
	const query = api.queryFor(box, true);
	assert.ok(query.includes(`out skel geom(${box}) qt`));
	assert.ok(query.includes(`node(w.trails)(${box})`));
	assert.ok(query.includes("\"a\"=t[\"hazard:forward\"]"));
	assert.doesNotMatch(query, /out body|t\["name"\]|t\["source"\]/);
	assert.doesNotMatch(query, /\["mtb:scale"~/);
	assert.match(api.queryFor(box, false), /\["mtb:scale"~/);
	const elements = api.unpack([
		{ ...way, tags: undefined },
		{
			type: "krb_way",
			id: 1,
			tags: { 0: "path", 2: "2", 3: "0.3", a: "slippery", d: "yes", c: "1" },
		},
		{ type: "node", id: 2, lat: 61, lon: 23 },
		{ type: "krb_node", id: 2, tags: { 8: "log" } },
	]);
	const [trail, node] = api.convertRoute(elements).features;
	assert.equal(trail.properties.trailRating, "S2");
	assert.equal(trail.properties.widthMetres, 0.3);
	assert.equal(trail.properties.bridge, "yes");
	assert.match(trail.properties.label, /hazard:forward: slippery/);
	assert.equal(node.properties.parentWayIds.join(), "way/1");
	assert.equal(node.properties.log, true);
});

test("cropped ways retain separate fragments without connecting null geometry gaps", function () {
	const api = setup();
	const cropped = {
		...way,
		nodes: [10, 11, 12, 13, 14, 15, 16],
		geometry: [
			null,
			{ lat: 61, lon: 23 },
			{ lat: 61, lon: 23.001 },
			null,
			{ lat: 61, lon: 23.003 },
			{ lat: 61, lon: 23.004 },
			null,
		],
	};
	const data = api.convert([cropped, cropped]);
	assert.equal(data.features.length, 2);
	assert.equal(data.features[0].id, "way/1/11:12");
	assert.equal(data.features[1].id, "way/1/14:15");
	assert.equal(data.counts.total, 1);
	assert.ok(data.features.every((f) => f.geometry.coordinates.length === 2));
});

test("adjacent cache areas preserve different fragments of the same OSM way", async function () {
	let calls = 0;
	const api = setup(async function () {
		calls++;
		return new Response(
			JSON.stringify({
				elements: [
					{
						...way,
						nodes: calls === 1 ? [10, 11] : [11, 12],
						tags: { highway: "path", "mtb:scale": "2", width: "0.3" },
						geometry:
							calls === 1
								? [
										{ lat: 61, lon: 23 },
										{ lat: 61, lon: 23.01 },
									]
								: [
										{ lat: 61, lon: 23.01 },
										{ lat: 61, lon: 23.02 },
									],
					},
				],
			}),
		);
	});
	await api.loadRoute([61, 23, 61.01, 23.01]);
	await api.loadRoute([61, 23.01, 61.01, 23.02]);
	const combined = await api.loadRoute([61, 23.001, 61.01, 23.019]);
	assert.equal(calls, 2);
	assert.equal(combined.features.length, 2);
	assert.equal(combined.counts.total, 1);
	assert.equal((await api.load([61, 23.001, 61.01, 23.019])).features.length, 2);
});

test("missing projected details are rejected rather than cached as empty coverage", async function () {
	const api = setup(async function () {
		return new Response(JSON.stringify({ elements: [{ ...way, tags: undefined }] }));
	});
	await assert.rejects(api.loadRoute([61, 23, 61.01, 23.01]), /incomplete feature details/);
	assert.equal(api.cacheStats().areas, 0);
	assert.throws(() => api.unpack([{ ...way, tags: undefined }]), /incomplete/);
});

test("route batches combine adjoining misses but preserve individual cache hits", async function () {
	let calls = 0;
	const api = setup(async function () {
		calls++;
		return new Response(JSON.stringify({ elements: [] }));
	});
	const cells = Array.from({ length: 4 }, (_, i) => [61, 23 + i * 0.01, 61.01, 23.011 + i * 0.01]);
	const result = await api.loadRoute(cells[0], cells.slice(1));
	assert.equal(result.coveredAreas, 4);
	assert.equal(calls, 1);
	for (const cell of cells) assert.notEqual((await api.loadRoute(cell)).cacheSource, "network");
	assert.equal(calls, 1);
	// A separately cached next cell must not be included in an uncached request.
	const other = setup(async function () {
		calls++;
		return new Response(JSON.stringify({ elements: [] }));
	});
	await other.loadRoute(cells[1]);
	assert.equal((await other.loadRoute(cells[0], cells.slice(1))).coveredAreas, 1);
	assert.equal((await other.loadRoute(cells[1], cells.slice(2))).cacheSource, "memory");
	assert.equal(calls, 3);
});

test("route batches reject distant cells and cap their enclosing area", async function () {
	const api = setup(async function () {
		return new Response(JSON.stringify({ elements: [] }));
	});
	assert.equal(
		(await api.loadRoute([61, 23, 61.01, 23.01], [[62, 23, 62.01, 23.01]])).coveredAreas,
		1,
	);
	assert.equal(
		(await api.loadRoute([63, 23, 63.02, 23.04], [[63, 23.039, 63.02, 23.08]])).coveredAreas,
		1,
	);
});

test("failed combined queries retry as single cells after provider cooldown", async function () {
	let now = 1000000,
		failing = true;
	const queries = [];
	const context = {
		URL,
		URLSearchParams,
		AbortSignal,
		TextDecoder,
		Date: { now: () => now, parse: Date.parse },
		async fetch(url, options) {
			queries.push(options.body.get("data"));
			return failing
				? new Response("busy", { status: 504 })
				: new Response(JSON.stringify({ elements: [] }));
		},
	};
	initialise(context);
	const first = [61, 23, 61.01, 23.011],
		following = [[61, 23.01, 61.01, 23.021]];
	await assert.rejects(context.KrbHazards.loadRoute(first, following), /504/);
	assert.equal(context.KrbHazards.cacheStats().areas, 0);
	now += 31000;
	failing = false;
	const result = await context.KrbHazards.loadRoute(first, following);
	assert.equal(result.coveredAreas, 1);
	assert.notEqual(queries[0], queries.at(-1));
});

test("long route collection uses fewer network requests and reuses all combined coverage", async function () {
	let requests = 0;
	const api = setup(async function () {
		requests++;
		return new Response(JSON.stringify({ elements: [] }));
	});
	const context = {};
	runInNewContext(readFileSync(new URL("../route-check.js", import.meta.url), "utf8"), context);
	const route = {
		type: "Feature",
		geometry: {
			type: "LineString",
			coordinates: [
				[23, 61],
				[24.5, 61],
			],
		},
	};
	const total = context.KrbRouteCheck.areas(route).length;
	const checkpoint = {};
	await context.KrbRouteCheck.collect(
		route,
		async function (bounds, following) {
			return { data: await api.loadRoute(bounds, following) };
		},
		{ checkpoint },
	);
	assert.ok(total > 70);
	assert.ok(requests <= Math.ceil(total / 3), `${requests} requests for ${total} cells`);
	assert.equal(checkpoint.completed, total);
	const initial = requests;
	await context.KrbRouteCheck.collect(route, async function (bounds, following) {
		return { data: await api.loadRoute(bounds, following) };
	});
	assert.equal(requests, initial);
});

test("global queue allows two distinct providers, deduplicates coverage, and caps all callers", async function () {
	const pending = [],
		running = new Set();
	let peak = 0;
	const api = setup(function (url) {
		assert.equal(running.has(url), false);
		running.add(url);
		peak = Math.max(peak, running.size);
		return new Promise(function (resolve) {
			pending.push({
				url,
				finish() {
					running.delete(url);
					resolve(new Response(JSON.stringify({ elements: [] })));
				},
			});
		});
	});
	const first = api.loadRoute([61, 23, 61.01, 23.01]);
	const duplicate = api.loadRoute([61, 23, 61.01, 23.01]);
	const second = api.load([62, 23, 62.01, 23.01]);
	const third = api.loadRoute([63, 23, 63.01, 23.01]);
	for (let i = 0; i < 20 && pending.length < 2; i++)
		await new Promise((resolve) => setImmediate(resolve));
	assert.equal(pending.length, 2);
	assert.equal(new URL(pending[0].url).hostname, "overpass.private.coffee");
	assert.equal(new URL(pending[1].url).hostname, "maps.mail.ru");
	pending[0].finish();
	for (let i = 0; i < 20 && pending.length < 3; i++)
		await new Promise((resolve) => setImmediate(resolve));
	assert.equal(pending.length, 3);
	assert.equal(pending[2].url, pending[0].url);
	pending[1].finish();
	pending[2].finish();
	await Promise.all([first, duplicate, second, third]);
	assert.equal(peak, 2);
});

test("clearing the cache waits for both concurrent downloads", async function () {
	const finish = [];
	const api = setup(function () {
		return new Promise(function (resolve) {
			return finish.push(() => resolve(new Response(JSON.stringify({ elements: [] }))));
		});
	});
	const a = api.loadRoute([61, 23, 61.01, 23.01]),
		b = api.loadRoute([62, 23, 62.01, 23.01]);
	for (let i = 0; i < 20 && finish.length < 2; i++)
		await new Promise((resolve) => setImmediate(resolve));
	assert.equal(finish.length, 2);
	let cleared = false;
	const clearing = api.clearCache().then(function () {
		cleared = true;
	});
	finish[0]();
	await a;
	assert.equal(cleared, false);
	finish[1]();
	await b;
	await clearing;
	assert.equal(api.cacheStats().areas, 0);
});

test("one failed provider falls back without interrupting the other active provider", async function () {
	const pending = [],
		running = new Set();
	const api = setup(function (url) {
		assert.equal(running.has(url), false);
		running.add(url);
		assert.ok(running.size <= 2);
		return new Promise(function (resolve) {
			pending.push({
				url,
				finish(status = 200) {
					running.delete(url);
					resolve(
						status === 200
							? new Response(JSON.stringify({ elements: [] }))
							: new Response("busy", { status, headers: { "Retry-After": "60" } }),
					);
				},
			});
		});
	});
	const a = api.loadRoute([61, 23, 61.01, 23.01]),
		b = api.loadRoute([62, 23, 62.01, 23.01]);
	for (let i = 0; i < 20 && pending.length < 2; i++)
		await new Promise((resolve) => setImmediate(resolve));
	pending[0].finish(429);
	for (let i = 0; i < 20 && pending.length < 3; i++)
		await new Promise((resolve) => setImmediate(resolve));
	assert.equal(new URL(pending[2].url).hostname, "overpass-api.de");
	assert.equal(running.has(pending[1].url), true);
	pending[1].finish();
	pending[2].finish();
	await Promise.all([a, b]);
});

test("route cache refreshes legacy entries missing way type and surface, preserving map use", async function () {
	const indexedDB = new IDBFactory();
	const seed = { indexedDB, TextEncoder };
	runInNewContext(readFileSync(new URL("../osm-cache.js", import.meta.url), "utf8"), seed);
	const cache = seed.KrbOsmCache.create();
	const legacy = setup().convertRoute([{ ...way, tags: { ...way.tags, highway: "path" } }]);
	delete legacy.trailSchema;
	await cache.put({
		key: "61,23,61.02,23.02",
		time: Date.now(),
		routeComplete: true,
		data: legacy,
	});
	await cache.close();
	let calls = 0;
	const context = {
		indexedDB,
		URL,
		URLSearchParams,
		AbortSignal,
		TextDecoder,
		async fetch() {
			calls++;
			return new Response(
				JSON.stringify({
					elements: [{ ...way, tags: { ...way.tags, highway: "path", surface: "dirt" } }],
				}),
			);
		},
	};
	initialise(context);
	await context.KrbHazards.load([61, 23, 61.01, 23.01]);
	assert.equal(calls, 0);
	const data = await context.KrbHazards.loadRoute([61, 23, 61.01, 23.01]);
	assert.equal(calls, 1);
	assert.equal(data.features[0].properties.highway, "path");
	assert.equal(data.features[0].properties.surface, "dirt");
	await context.KrbHazards.loadRoute([61, 23, 61.01, 23.01]);
	assert.equal(calls, 1);
});
