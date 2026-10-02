import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const context = {};
runInNewContext(readFileSync(new URL("../route-check.js", import.meta.url), "utf8"), context);
const api = context.KrbRouteCheck;
const point = (x, y = 0) => [23 + x / (111195 * Math.cos(61 * Math.PI / 180)), 61 + y / 111195];
const route = (coordinates = [point(0), point(200)], properties = {}) => ({ type: "Feature", properties, geometry: { type: "LineString", coordinates } });
const way = (id, coordinates = [point(0), point(200)], properties = {}) => ({ type: "Feature", id: `way/${id}`, properties: { osmId: `way/${id}`, highway: "path", surface: "dirt", trailRating: "S1", widthMetres: 0.4, ...properties }, geometry: { type: "LineString", coordinates } });

test("defaults and preference bounds are independent of map display", function () {
	assert.equal(api.preferences().maximumLevel, "S1");
	assert.equal(api.preferences().minimumWidth, 0.4);
	assert.equal(api.preferences().allowHazards, false);
	assert.equal(api.preferences({ minimumWidth: 0.26 }).minimumWidth, 0.3);
	assert.equal(api.preferences({ minimumWidth: 5 }).minimumWidth, 1);
});

test("difficulty-only ways warn; equal width passes; plus ratings exceed the whole level", function () {
	const result = api.analyse(route(), [way(1, undefined, { trailRating: "S1+" })]);
	assert.equal(result.warnings.length, 1);
	assert.equal(result.warnings[0].kind, "difficulty");
	assert.equal(result.unknown.unmatched, 0);
	assert.equal(api.analyse(route(), [way(1)]).warnings.length, 0);
	assert.equal(api.analyse(route(), [way(1, undefined, { trailRating: "S1-" })]).warnings.length, 0);
});

test("allow hazards does not suppress difficulty or width; estimates are explicit", function () {
	const feature = way(1, undefined, { trailRating: "S2", widthMetres: 0.3, widthEstimated: true, mud: true });
	assert.equal(api.analyse(route(), [feature]).warnings.length, 3);
	const allowed = api.analyse(route(), [feature], { allowHazards: true });
	assert.equal(allowed.warnings.length, 2);
	assert.equal(allowed.warnings.find((w) => w.kind === "width").text, "Width (0.3m)");
});

test("crossings and nearby disconnected obstacles are not route hazards", function () {
	const crossing = way(2, [point(100, -100), point(100, 100)], { trailRating: "S5" });
	const node = { type: "Feature", properties: { osmId: "node/1", parentWayIds: ["way/2"], label: "Log" }, geometry: { type: "Point", coordinates: point(100) } };
	assert.equal(api.analyse(route(), [way(1), crossing, node]).warnings.length, 0);
});

test("close parallel ways and overlapping bridge ways are ambiguous", function () {
	for (const other of [way(2, [point(0, 2), point(200, 2)], { trailRating: "S5" }), way(2, undefined, { bridge: "yes", layer: "1", trailRating: "S5" })]) {
		const result = api.analyse(route(), [way(1), other]);
		assert.equal(result.warnings.length, 0);
		assert.ok(result.unknown.unmatched > 190);
	}
	const result = api.analyse(route(undefined, { layer: "0" }), [way(1, undefined, { layer: "0" }), way(2, undefined, { layer: "1", trailRating: "S5" })]);
	assert.equal(result.unknown.unmatched, 0);
});

test("reversed travel and repeated visits preserve route distances", function () {
	const result = api.analyse(route([point(200), point(0), point(200)]), [way(1, [point(0), point(60)], { trailRating: "S3" })]);
	assert.ok(result.warnings[0].distance > 130);
	assert.ok(result.distance > 399 && result.distance < 401);
});

test("unrated and missing width remain unknown, short isolated matches are rejected", function () {
	const unknown = api.analyse(route(), [way(1, undefined, { trailRating: "", widthMetres: undefined })]);
	assert.ok(unknown.unknown.rating > 199);
	assert.equal(unknown.unknown.width, 0);
	assert.equal(unknown.warnings.length, 0);
	const short = api.analyse(route(), [way(2, [point(90), point(95)], { trailRating: "S5" })]);
	assert.equal(short.warnings.length, 0);
});

test("off-grid segments and disjoint route parts are not joined", function () {
	assert.ok(api.analyse(route(undefined, { segment_type: "OffGrid" }), [way(1)]).unknown.unmatched > 199);
	const split = { type: "FeatureCollection", features: [route([point(0), point(100)]), route([point(500), point(600)])] };
	assert.ok(api.analyse(split, []).distance < 201);
	assert.equal(api.signature(route()), api.signature(route(undefined, { selected: true })));
	assert.notEqual(api.signature(route()), api.signature(route([point(0), point(300)])));
});

test("obstacles are associated with traversed parent ways and grouped", function () {
	const obstacle = { properties: { osmId: "node/5", parentWayIds: ["way/1"], label: "barrier: log", log: true }, geometry: { type: "Point", coordinates: point(100) } };
	const result = api.analyse(route(), [way(1), obstacle, obstacle]);
	assert.equal(result.warnings.length, 1);
	assert.equal(result.warnings[0].text, "Fallen tree");
	assert.equal(api.analyse(route(), [way(1), obstacle], { allowHazards: true }).warnings.length, 0);
});

test("whole-route area collection has no eight-cell cap and remains sequential", async function () {
	const long = route([point(0), point(15000)]);
	assert.ok(api.areas(long).length > 8);
	let active = 0, peak = 0, calls = 0;
	const result = await api.collect(long, async function () {
		calls++; active++; peak = Math.max(peak, active);
		await Promise.resolve(); active--;
		return { data: { type: "FeatureCollection", features: [way(1)] } };
	});
	assert.equal(peak, 1);
	assert.ok(calls > 8);
	assert.equal(result.length, 1);
});

test("cancel stops future queries; incomplete responses retain previous findings", async function () {
	const long = route([point(0), point(3000)]), controller = new AbortController();
	let calls = 0;
	await assert.rejects(api.collect(long, async function () {
		calls++; controller.abort(); return { data: { type: "FeatureCollection", features: [] } };
	}, { signal: controller.signal }), { name: "AbortError" });
	assert.equal(calls, 1);
	calls = 0;
	await assert.rejects(api.collect(long, async function () {
		return ++calls === 1 ? { data: { type: "FeatureCollection", features: [way(1)] } } : { error: "HTTP 429", retryMs: 30000 };
	}), function (error) { return error.features.length === 1 && error.completed === 1 && error.retryMs === 30000; });
	assert.equal(calls, 2);
});


test("node width limits still apply when hazards are allowed", function () {
	const node = { properties: { osmId: "node/6", parentWayIds: ["way/1"], label: "Width: 0.2m", widthMetres: 0.2, narrow: true }, geometry: { type: "Point", coordinates: point(100) } };
	const result = api.analyse(route(), [way(1), node], { allowHazards: true });
	assert.equal(result.warnings.length, 1);
	assert.equal(result.warnings[0].kind, "width");
});

test("identical warnings across adjoining OSM paths and route parts merge", function () {
	const split = { type: "FeatureCollection", features: [route([point(0), point(100)]), route([point(100), point(200)])] };
	const result = api.analyse(split, [way(1, [point(0), point(100)], { trailRating: "S2", mud: true }), way(2, [point(100), point(200)], { trailRating: "S2", mud: true })]);
	assert.equal(result.warnings.length, 2);
	assert.equal(result.warnings.filter((w) => w.kind === "difficulty").length, 1);
	assert.equal(result.warnings.filter((w) => w.kind === "hazard").length, 1);
	assert.ok(result.warnings[0].end > 190);
});

test("warning gaps use section ends: below 50m merges, 50m and above remain separate", function () {
	const samples = api.samples(route([point(0), point(500)]));
	function warning(start, end, text = "S2 trail exceeds S1") {
		return { kind: "difficulty", text, distance: start, end, part: 0, point: point(start), coordinates: [point(start), point(end)] };
	}
	for (const [gap, expected] of [[0, 1], [49.9, 1], [50, 2], [50.1, 2]]) {
		const input = [warning(10, 250), warning(250 + gap, 400)];
		const result = api.groupWarnings(input, samples);
		assert.equal(result.length, expected, `gap ${gap}`);
		assert.equal(result[0].distance, 10);
		assert.equal(input[0].end, 250);
		if (expected === 1) assert.equal(result[0].end, 400);
	}
	assert.equal(api.groupWarnings([warning(10, 100), warning(110, 200, "S3 trail exceeds S1")], samples).length, 2);
});

test("identical warnings on disconnected route parts remain separate", function () {
	const split = { type: "FeatureCollection", features: [route([point(0), point(100)]), route([point(500), point(600)])] };
	const result = api.analyse(split, [way(1, [point(0), point(100)], { trailRating: "S2" }), way(2, [point(500), point(600)], { trailRating: "S2" })]);
	assert.equal(result.warnings.length, 2);
});


test("route warnings use readable OSM descriptions for both paths and nodes", function () {
	for (const [label, expected] of [
		["obstacle: fallen_tree", "Fallen tree"],
		["barrier: log", "Fallen tree"],
		["barrier: gate", "Gate"],
		["overgrown: yes", "Overgrown path"],
		["overgrown: dense", "Overgrown (dense)"],
		["hazard:forward: slippery · hazard:backward: slippery", "Slippery"],
		["obstacle: vegetation · Width: 0.3 m", "Vegetation"],
		["hazard: rockfall", "hazard: rockfall"]
	]) {
		const properties = { label, other: true };
		const pathResult = api.analyse(route(), [way(1, undefined, properties)]);
		assert.equal(pathResult.warnings[0].text, expected);
		const node = { properties: { ...properties, osmId: "node/1", parentWayIds: ["way/1"] }, geometry: { type: "Point", coordinates: point(100) } };
		assert.equal(api.analyse(route(), [way(1), node]).warnings[0].text, expected);
	}
});

test("measured and estimated widths have the requested wording without raw duplicates", function () {
	for (const [estimated, expected] of [[false, "Narrow (0.3m) path"], [true, "Width (0.3m)"]]) {
		const result = api.analyse(route(), [way(1, undefined, { widthMetres: 0.3, widthEstimated: estimated, label: "obstacle: fallen_tree · Width: 0.3 m", log: true, other: true })]);
		assert.equal(result.warnings.find((w) => w.kind === "width").text, expected);
		assert.equal(result.warnings.find((w) => w.kind === "hazard").text, "Fallen tree");
	}
});

test("retry resumes at failed area, retains results, and resets for changed geometry", async function () {
	const long = route([point(0), point(3000)]), checkpoint = {};
	const boxes = api.areas(long);
	let calls = 0;
	await assert.rejects(api.collect(long, async function () {
		if (++calls === 3) throw new Error("Disconnected");
		return { data: { type: "FeatureCollection", features: [way(calls)] } };
	}, { checkpoint }), /Disconnected/);
	assert.equal(checkpoint.completed, 2);
	const retried = [], progress = [];
	const result = await api.collect(long, async function (bounds) {
		retried.push(bounds);
		return { data: { type: "FeatureCollection", features: [] } };
	}, { checkpoint, progress(value) { progress.push(value.completed); } });
	assert.equal(progress[0], 2);
	assert.equal(JSON.stringify(retried[0]), JSON.stringify(boxes[2]));
	assert.equal(retried.length, boxes.length - 2);
	assert.equal(result.length, 2);
	const changedProgress = [];
	await api.collect(route([point(0), point(200)]), async function () {
		return { data: { type: "FeatureCollection", features: [] } };
	}, { checkpoint, progress(value) { changedProgress.push(value.completed); } });
	assert.equal(changedProgress[0], 0);
	assert.equal(checkpoint.features.length, 0);
});

test("automatic retries preserve progress, honour cooldowns, and recover", async function () {
	const long = route([point(0), point(3000)]), checkpoint = {};
	let now = 0, calls = 0, failedBounds;
	const delays = [], waiting = [];
	await api.collectWithRetry(long, async function (bounds) {
		calls++;
		if (calls === 2) { failedBounds = JSON.stringify(bounds); return { error: "HTTP 429", retryMs: 90000 }; }
		if (calls === 3) assert.equal(JSON.stringify(bounds), failedBounds);
		return { data: { type: "FeatureCollection", features: [] } };
	}, { checkpoint, now: () => now, async wait(ms) { delays.push(ms); now += ms; }, waiting(value) { waiting.push(value); } });
	assert.deepEqual(delays, [90000]);
	assert.equal(waiting[0].completed, 1);
	assert.equal(calls, api.areas(long).length + 1);
});

test("temporary failures retry for ten minutes without hammering or losing cancellation", async function () {
	let now = 0, calls = 0;
	await assert.rejects(api.collectWithRetry(route(), async function () { calls++; return { error: "HTTP 504" }; }, {
		now: () => now, async wait(ms) { assert.ok(ms >= 30000); now += ms; }
	}), /504/);
	assert.equal(now, 600000);
	assert.equal(calls, 20);
	const controller = new AbortController();
	calls = 0;
	await assert.rejects(api.collectWithRetry(route(), async function () { calls++; return { error: "Offline" }; }, {
		signal: controller.signal, async wait() { controller.abort(); }
	}), { name: "AbortError" });
	assert.equal(calls, 1);
});

test("permanent failures do not retry", async function () {
	await assert.rejects(api.collectWithRetry(route(), async () => ({ error: "Invalid query", status: 400 }), {
		async wait() { assert.fail("Permanent errors must not wait"); }
	}), /Invalid query/);
});


test("route progress distinguishes cached areas from downloaded areas", async function () {
	const long = route([point(0), point(3000)]);
	let index = 0, last;
	const checkpoint = {};
	await api.collect(long, async function () {
		return { data: { type: "FeatureCollection", features: [], cacheSource: index++ === 0 ? "disk" : "network" } };
	}, { checkpoint, progress(value) { last = value; } });
	assert.equal(last.cached, 1);
	assert.equal(last.downloaded, index - 1);
	assert.equal(checkpoint.cached, 1);
});

test("route matching retains cropped fragments and never bridges missing geometry", async function () {
	const a = { ...way(1, [point(0), point(80)], { trailRating: "S2" }), id: "way/1/10:11" };
	const b = { ...way(1, [point(120), point(200)], { trailRating: "S2" }), id: "way/1/12:13" };
	const result = api.analyse(route(), [a, b, a]);
	assert.ok(result.unknown.unmatched >= 19 && result.unknown.unmatched <= 41);
	assert.equal(result.warnings.length, 1);
	assert.ok(result.warnings[0].end > 180);
	const features = await api.collect(route(), async function () { return { data: { type: "FeatureCollection", features: [a, b] } }; });
	assert.equal(features.length, 2);
});

test("batched progress resumes after the last completed batch", async function () {
	const long = route([point(0), point(10000)]), checkpoint = {};
	let calls = 0;
	await assert.rejects(api.collect(long, async function (bounds, following) {
		calls++;
		assert.equal(following.length, 3);
		return calls === 1 ? { data: { type: "FeatureCollection", features: [], coveredAreas: 4, cacheSource: "network" } } : { error: "busy" };
	}, { checkpoint }), /busy/);
	assert.equal(checkpoint.completed, 4);
	assert.equal(checkpoint.downloaded, 4);
	let first;
	await api.collect(long, async function (bounds) { first ||= bounds; return { data: { type: "FeatureCollection", features: [], cacheSource: "memory" } }; }, { checkpoint });
	assert.equal(JSON.stringify(first), JSON.stringify(api.areas(long)[4]));
	assert.equal(checkpoint.completed, api.areas(long).length);
});

test("parallel checkpoints keep out-of-order batches when another batch fails", async function () {
	const long = route([point(0), point(15000)]), checkpoint = {}, pending = [];
	const work = api.collect(long, function (bounds, following) {
		return new Promise(function (resolve) { pending.push({ bounds, following, resolve }); });
	}, { checkpoint, concurrency: 2 });
	assert.equal(pending.length, 2);
	assert.equal(pending[0].following.length, 3);
	assert.equal(pending[1].following.length, 3);
	pending[0].resolve({ error: "HTTP 504" });
	await Promise.resolve(); await Promise.resolve();
	pending[1].resolve({ data: { type: "FeatureCollection", features: [], coveredAreas: 4, cacheSource: "network" } });
	await assert.rejects(work, /504/);
	assert.equal(checkpoint.completed, 4);
	assert.equal(JSON.stringify(checkpoint.completedAreas), "[4,5,6,7]");
	const requested = [];
	await api.collect(long, async function (bounds) {
		requested.push(JSON.stringify(bounds));
		return { data: { type: "FeatureCollection", features: [], cacheSource: "memory" } };
	}, { checkpoint, concurrency: 2 });
	for (const i of [4, 5, 6, 7]) assert.equal(requested.includes(JSON.stringify(api.areas(long)[i])), false);
	assert.equal(checkpoint.completed, api.areas(long).length);
});

test("parallel cancellation ignores both late responses and schedules nothing further", async function () {
	const long = route([point(0), point(15000)]), checkpoint = {}, pending = [], controller = new AbortController();
	const work = api.collect(long, () => new Promise((resolve) => pending.push(resolve)), { checkpoint, concurrency: 2, signal: controller.signal });
	assert.equal(pending.length, 2);
	controller.abort();
	for (const resolve of pending) resolve({ data: { type: "FeatureCollection", features: [], coveredAreas: 4 } });
	await assert.rejects(work, /abort/i);
	assert.equal(checkpoint.completed, 0);
	assert.equal(pending.length, 2);
});

test("the faster worker continues while the first batch is still pending", async function () {
	const long = route([point(0), point(15000)]), checkpoint = {};
	let first, calls = 0;
	const work = api.collect(long, function (bounds, following) {
		if (++calls === 1) return new Promise(function (resolve) { first = resolve; });
		return Promise.resolve({ data: { type: "FeatureCollection", features: [], coveredAreas: following.length + 1 } });
	}, { checkpoint, concurrency: 2 });
	for (let i = 0; i < 30; i++) await Promise.resolve();
	assert.ok(calls > 2);
	assert.ok(checkpoint.completed > 4);
	assert.equal(checkpoint.completedAreas.includes(0), false);
	first({ data: { type: "FeatureCollection", features: [], coveredAreas: 4 } });
	await work;
	assert.equal(checkpoint.completed, api.areas(long).length);
});

test("trail checks exclude cycleways, roads and paved paths even with MTB and obstacle tags", function () {
	for (const highway of ["cycleway", "residential", "primary", "service", "unclassified", "road", "living_street"]) {
		const result = api.analyse(route(), [way(1, undefined, { highway, surface: "dirt", trailRating: "S5", widthMetres: undefined, log: true })]);
		assert.equal(result.warnings.length, 0, highway);
		assert.equal(result.checkedDistance, 0);
		assert.equal(result.unknown.rating + result.unknown.width + result.unknown.surface, 0);
	}
	for (const surface of ["paved", "asphalt", "concrete", "paving_stones"]) {
		const result = api.analyse(route(), [way(1, undefined, { surface, trailRating: "S5", log: true })]);
		assert.equal(result.warnings.length, 0, surface);
		assert.equal(result.unknown.width + result.unknown.rating + result.unknown.surface, 0);
	}
});

test("unpaved paths require MTB scale; explicit unknown and mixed surfaces stay unknown", function () {
	for (const highway of ["path", "track", "footway", "bridleway"]) {
		for (const surface of ["unpaved", "dirt", "ground", "gravel", "compacted"]) {
			const rated = api.analyse(route(), [way(1, undefined, { highway, surface, trailRating: "S3" })]);
			assert.equal(rated.warnings.length, 1);
			assert.ok(rated.checkedDistance > 199);
			const unrated = api.analyse(route(), [way(1, undefined, { highway, surface, trailRating: "", widthMetres: undefined, log: true })]);
			assert.ok(unrated.unknown.rating > 199);
			assert.equal(unrated.unknown.width, 0);
			assert.equal(unrated.warnings.length, 0);
		}
	}
	for (const surface of ["unknown", "asphalt;dirt"]) {
		const result = api.analyse(route(), [way(1, undefined, { surface, trailRating: "S5", widthMetres: undefined })]);
		assert.ok(result.unknown.surface > 199);
		assert.equal(result.unknown.rating + result.unknown.width, 0);
		assert.equal(result.warnings.length, 0);
	}
});

test("obstacle nodes on excluded cycleways do not produce trail warnings", function () {
	const node = { type: "Feature", id: "node/2", geometry: { type: "Point", coordinates: point(100) }, properties: { osmId: "node/2", parentWayIds: ["way/1"], log: true, other: true, widthMetres: 0.1 } };
	assert.equal(api.analyse(route(), [way(1, undefined, { highway: "cycleway" }), node]).warnings.length, 0);
});


test("MTB-rated paths without surface are assumed unpaved and checked at the selected maximum", function () {
	for (const highway of ["path", "track", "footway", "bridleway"]) {
		for (const surface of [undefined, "", "  "]) {
			const feature = way(1, undefined, { highway, surface });
			const result = api.analyse(route(), [feature], { maximumLevel: "S0" });
			assert.ok(result.checkedDistance > 199);
			assert.equal(result.unknown.surface, 0);
			assert.equal(result.warnings.length, 1);
			assert.equal(result.warnings[0].text, "S1 trail exceeds S0");
			assert.equal(api.analyse(route(), [feature], { maximumLevel: "S1" }).warnings.length, 0);
		}
	}
});

test("missing surface does not suppress width, way hazards or member-node hazards", function () {
	const feature = way(1, undefined, { surface: undefined, widthMetres: 0.3, mud: true });
	const node = { type: "Feature", id: "node/2", geometry: { type: "Point", coordinates: point(100) }, properties: { osmId: "node/2", parentWayIds: ["way/1"], log: true, other: true } };
	const result = api.analyse(route(), [feature, node], { maximumLevel: "S0" });
	assert.ok(result.warnings.some((w) => w.text === "Fallen tree"));
	assert.ok(result.warnings.some((w) => w.text === "Muddy surface"));
	assert.ok(result.warnings.some((w) => w.kind === "width"));
	const allowed = api.analyse(route(), [feature, node], { maximumLevel: "S0", allowHazards: true });
	assert.deepEqual(Array.from(allowed.warnings, (w) => w.kind).sort(), ["difficulty", "width"]);
});

test("missing surface without valid MTB rating stays unknown and excluded road classes stay excluded", function () {
	for (const trailRating of [undefined, "", "unknown"]) {
		const result = api.analyse(route(), [way(1, undefined, { surface: undefined, trailRating })]);
		assert.ok(result.unknown.surface > 199);
		assert.equal(result.checkedDistance, 0);
		assert.equal(result.warnings.length, 0);
	}
	for (const highway of ["cycleway", "residential", "primary", "service", "road"]) {
		const result = api.analyse(route(), [way(1, undefined, { highway, surface: undefined, trailRating: "S5", mud: true })]);
		assert.equal(result.checkedDistance, 0);
		assert.equal(result.warnings.length, 0);
	}
});
