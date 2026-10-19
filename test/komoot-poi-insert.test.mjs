import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const context = {};
runInNewContext(readFileSync(new URL("../komoot-poi-insert.js", import.meta.url), "utf8"), context);
const api = context.KrbKomootPoiInsert;

test("geometry comparison accepts rounded inserted vertices while rejecting actual detours", function () {
	const original = [{ lat: 61, lng: 23 }, { lat: 61.002, lng: 23 }];
	assert.equal(api.sameGeometry(original, [original[0], { lat: 61.001, lng: 23.0000007 }, original[1]]), true);
	assert.equal(api.sameGeometry(original, [original[0], { lat: 61.001, lng: 23.0001 }, original[1]]), false);
});
function fixture(mode) {
	let state = { items: [{ lat: 61, lng: 23 }, { lat: 61.001, lng: 23 }, { lat: 61.002, lng: 23 }],
		waypoints: [{ index: 0, location: { lat: 61, lng: 23 } }, { index: 2, location: { lat: 61.002, lng: 23 }, cnwId: 1, cnwName: "Existing", cnwCategory: 35 }] };
	if (mode?.startsWith("highlight")) Object.assign(state.waypoints[0], { type: "highlight_point", id: 7528607, name: "Watchtower" });
	const events = [], calls = [];
	const collection = { get models() {
		return state.waypoints.map(function (entry) {
			return { get: (key) => entry[key], link: () => ({ get: (key) => key === "type" ? entry.type ?? "point" : entry[key], set: (value) => Object.assign(entry, value) }) };
		});
	}, trigger: (event) => events.push(event) };
	const tour = {
		link: (relation) => relation === "coordinates" ? { get: () => state.items } : collection,
		toJSON: () => structuredClone(state),
		set(value) { state = structuredClone(value); },
		async wpAdd(value, options) { calls.push(value); state.waypoints.splice(options.at, 0, value); },
		async fetchByWaypoints() {
			if (mode === "failure") throw new Error("Routing failed");
			if (mode?.startsWith("highlight")) state.waypoints[0].id = String(state.waypoints[0].id);
			if (mode === "highlightChanged") state.waypoints[0].id = "7528608";
			if (mode === "highlightMoved") state.waypoints[0].location.lng += 0.001;
			if (mode === "highlightRenamed") state.waypoints[0].name = "Different";
			if (mode === "reroute") state.items[1].lng += 0.001;
			if (mode === "subdivision") {
				state.items.splice(1, 0, { ...calls[0].location });
				for (const waypoint of state.waypoints)
					waypoint.index = state.items.findIndex((point) => point.lat === waypoint.location.lat && point.lng === waypoint.location.lng);
			}
			if (mode === "normalizedCustom") {
				for (const waypoint of state.waypoints) {
					if (waypoint.cnwId == null) continue;
					waypoint.cnwName = waypoint.cnwName ?? waypoint.name;
					delete waypoint.name;
					if (!waypoint.cnwDescription) delete waypoint.cnwDescription;
				}
			}
			if (mode === "missingName") state.waypoints[1].cnwName = "Lost";
			if (mode === "existingChanged") state.waypoints.at(-1).cnwName = "Changed";
		},
	};
	return { tour, events, calls, read: () => structuredClone(state) };
}
const poi = { id: "hills", kind: "hills", name: "Hills", distance: 111.1949266446, point: [23, 61.001] },
	control = { cancelled: () => false, isCurrent: () => true };

test("native insertion uses unused IDs, verified icons and preserves existing POIs", async function () {
	const f = fixture("subdivision"), original = f.read();
	const result = await api.insert(f.tour, [poi], control);
	assert.equal(result.added, 1);
	assert.equal(f.calls[0].cnwId, 2);
	assert.equal(f.calls[0].cnwCategory, 35);
	assert.deepEqual({ ...f.read().waypoints.at(-1), index: 2 }, original.waypoints.at(-1));
	assert.equal(api.sameGeometry(original.items, f.read().items), true);
	assert.equal(f.events.length, 1);
	const again = await api.insert(f.tour, [poi], control);
	assert.equal(again.added, 0);
	assert.equal(again.skipped, 1);
	assert.equal(f.calls.length, 1);
});

test("rerouting, failed recalculation and missing metadata restore the original state", async function () {
	for (const mode of ["reroute", "failure", "missingName", "existingChanged"]) {
		const f = fixture(mode), original = f.read();
		await assert.rejects(api.insert(f.tour, [poi], control), /restored/);
		assert.deepEqual(f.read(), original);
	}
});

test("cancelled and stale requests do not mutate the route", async function () {
	for (const flags of [{ cancelled: () => true, isCurrent: () => true }, { cancelled: () => false, isCurrent: () => false }]) {
		const f = fixture(), original = f.read();
		assert.equal((await api.insert(f.tour, [poi], flags)).cancelled, true);
		assert.equal(f.calls.length, 0);
		assert.deepEqual(f.read(), original);
	}
	const f = fixture();
	await assert.rejects(api.insert(f.tour, [{ ...poi, point: [24, 61] }], control), /no longer matches/);
	assert.equal(f.calls.length, 0);
});


test("existing custom POIs expose names and route progress without changing the model", function () {
	const f = fixture(), before = JSON.stringify(f.read()), items = api.existingPois(f.tour);
	assert.equal(items.length, 1);
	assert.equal(items[0].name, "Existing");
	assert.equal(items[0].category, 35);
	assert.ok(items[0].geometryDistance > 220 && items[0].geometryDistance < 225);
	assert.deepEqual(Array.from(items[0].point), [23, 61.002]);
	assert.equal(JSON.stringify(f.read()), before);
});


test("duplicate insertion recognizes the same POI with a different icon or capitalization near a densely sampled vertex", async function () {
	let additions = 0;
	const points = [{ lat: 61, lng: 23 }, { lat: 61.00001, lng: 23 }, { lat: 61.00002, lng: 23 }],
		reference = { get: (key) => ({ cnwName: " HALFway ", cnwCategory: 24, cnwId: 1, location: points[1] })[key] },
		tour = {
			link: (relation) => relation === "coordinates" ? { get: () => points } : { models: [{ get: () => 1, link: () => reference }] },
			toJSON: () => ({ points }),
			set() {},
			async wpAdd() { additions++; },
			async fetchByWaypoints() {},
		};
	const result = await api.insert(tour, [{ id: "halfway", kind: "halfway", name: "Halfway", point: [23, 61.000015], distance: 1.6679239 }], control);
	assert.equal(result.skipped, 1);
	assert.equal(result.added, 0);
	assert.equal(additions, 0);
});


test("native insertion writes Checkpoint and Danger category IDs for generated POIs", async function () {
	for (const [kind, expected] of [["halfway", 35], ["gravel", 35], ["hills", 35], ["trails", 5], ["technical", 5]]) {
		const f = fixture("subdivision");
		await api.insert(f.tour, [{ ...poi, kind }], control);
		assert.equal(f.calls[0].cnwCategory, expected);
	}
});


test("recalculation can normalize custom POI name fields without rolling back existing POIs", async function () {
	const f = fixture("normalizedCustom");
	const original = f.read();
	original.waypoints.at(-1).name = "Existing";
	f.tour.set(original);
	await api.insert(f.tour, [poi], control);
	// A subsequent addition recalculates a POI previously created by this adapter.
	const result = await api.insert(f.tour, [{ ...poi, id: "second", name: "Gravel", kind: "gravel", distance: 166.7923899669, point: [23, 61.0015] }], control);
	assert.equal(result.added, 1);
	assert.deepEqual(f.read().waypoints.map((entry) => entry.cnwName).filter(Boolean), ["Hills", "Gravel", "Existing"]);
});


test("a POI at the start customizes the existing waypoint instead of adding a duplicate", async function () {
	const f = fixture("normalizedCustom"), original = f.read();
	const result = await api.insert(f.tour, [{ ...poi, id: "start", kind: "trails", name: "Trails", distance: 0, point: [23, 61] }, poi], control);
	assert.equal(result.added, 2);
	assert.equal(f.calls.length, 1);
	assert.equal(f.read().waypoints.length, original.waypoints.length + 1);
	assert.equal(f.read().waypoints[0].cnwName, "Trails");
	assert.equal(f.read().waypoints[0].cnwCategory, 5);
	assert.deepEqual(f.read().items, original.items);
});

test("failed recalculation restores a customized starting waypoint", async function () {
	const f = fixture("failure"), original = f.read();
	await assert.rejects(api.insert(f.tour, [{ ...poi, distance: 0, point: [23, 61] }], control), /restored/);
	assert.deepEqual(f.read(), original);
});


test("a customized endpoint still rejects changes to existing waypoint metadata", async function () {
	const f = fixture("existingChanged"), original = f.read();
	await assert.rejects(api.insert(f.tour, [{ ...poi, distance: 0, point: [23, 61] }], control), /existing route waypoint/);
	assert.deepEqual(f.read(), original);
});


test("route edits remove generated customizations but retain waypoints and manual POIs", async function () {
	const f = fixture(), original = f.read();
	original.waypoints[0].name = "Original start";
	f.tour.set(original);
	await api.insert(f.tour, [{ ...poi, id: "start", distance: 0, point: [23, 61] }, { ...poi, id: "half", kind: "halfway", name: "Halfway" }], control);
	assert.equal(api.clearStale(f.tour), 0);
	const changed = f.read();
	changed.items[1].lng += 0.001;
	f.tour.set(changed); // Simulate Komoot rebuilding its models, including after a page reload.
	assert.equal(api.clearStale(f.tour), 2);
	const after = f.read();
	assert.equal(after.waypoints.length, changed.waypoints.length);
	assert.deepEqual(after.items, changed.items);
	assert.equal(after.waypoints[0].name, "Original start");
	assert.equal(after.waypoints[1].cnwId, null);
	assert.equal(after.waypoints[1].cnwName, null);
	assert.deepEqual(after.waypoints.at(-1), original.waypoints.at(-1));
	assert.equal(api.clearStale(f.tour), 0);
	assert.equal(api.existingPois(f.tour).length, 1);
});

test("manually renamed generated POIs are preserved after a route edit", async function () {
	const f = fixture();
	await api.insert(f.tour, [poi], control);
	const changed = f.read();
	changed.waypoints[1].cnwName = "My stop";
	changed.items[1].lng += 0.001;
	f.tour.set(changed);
	assert.equal(api.clearStale(f.tour), 0);
	assert.equal(f.read().waypoints[1].cnwName, "My stop");
});


test("nearby ordinary waypoint is customized in place and regains its name after an edit", async function () {
	const f = fixture(), original = f.read();
	original.waypoints.splice(1, 0, { index: 0.5, location: { lat: 61.0005, lng: 23 }, name: "My waypoint" });
	f.tour.set(original);
	const result = await api.insert(f.tour, [poi], control);
	assert.equal(result.added, 1);
	assert.equal(f.calls.length, 0);
	assert.equal(f.read().waypoints.length, original.waypoints.length);
	assert.deepEqual(f.read().waypoints[1].location, original.waypoints[1].location);
	assert.equal(f.read().waypoints[1].cnwName, "Hills");
	assert.deepEqual(f.read().items, original.items);
	const changed = f.read();
	changed.items[1].lng += 0.001;
	f.tour.set(changed);
	assert.equal(api.clearStale(f.tour), 1);
	assert.equal(f.read().waypoints[1].name, "My waypoint");
});

test("nearest eligible ordinary waypoint wins and existing custom POIs are protected", async function () {
	const f = fixture(), original = f.read();
	original.waypoints.splice(1, 0,
		{ index: 0.3, location: { lat: 61.0003, lng: 23 } },
		{ index: 0.8, location: { lat: 61.0008, lng: 23 } },
		{ index: 1, location: { lat: 61.001, lng: 23 }, cnwId: 9, cnwName: "My cafe", cnwCategory: 35 });
	f.tour.set(original);
	await api.insert(f.tour, [poi], control);
	assert.equal(f.calls.length, 0);
	assert.equal(f.read().waypoints[1].cnwName, undefined);
	assert.equal(f.read().waypoints[2].cnwName, "Hills");
	assert.deepEqual(f.read().waypoints[3], original.waypoints[3]);
});

test("waypoints physically nearby on a different part of a loop are not reused", async function () {
	const f = fixture(), original = f.read();
	original.items = [{ lat: 61, lng: 23 }, { lat: 61.01, lng: 23 }, { lat: 61, lng: 23 }, { lat: 61.002, lng: 23 }];
	original.waypoints.at(-1).index = 3;
	f.tour.set(original);
	await api.insert(f.tour, [{ ...poi, distance: 2223.898532891 + 55.5974633223, point: [23, 61.0005] }], control);
	assert.equal(f.calls.length, 1);
	assert.equal(f.read().waypoints[0].cnwName, undefined);
});


test("hydrated Highlight IDs preserve existing waypoints when Komoot converts numbers to strings", async function () {
	const f = fixture("highlightNormalized");
	assert.equal((await api.insert(f.tour, [poi], control)).added, 1);
	assert.equal(f.read().waypoints[0].id, "7528607");
	assert.equal(f.read().waypoints[0].name, "Watchtower");
});

test("Highlight identity, location and name changes still restore the route", async function () {
	for (const mode of ["highlightChanged", "highlightMoved", "highlightRenamed"]) {
		const f = fixture(mode), original = f.read();
		await assert.rejects(api.insert(f.tour, [poi], control), /changed an existing route waypoint.*restored/);
		assert.deepEqual(f.read(), original);
	}
});
