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
	const events = [], calls = [];
	const collection = { get models() {
		return state.waypoints.map(function (entry) {
			return { get: (key) => entry[key], link: () => ({ get: (key) => entry[key] }) };
		});
	}, trigger: (event) => events.push(event) };
	const tour = {
		link: (relation) => relation === "coordinates" ? { get: () => state.items } : collection,
		toJSON: () => structuredClone(state),
		set(value) { state = structuredClone(value); },
		async wpAdd(value, options) { calls.push(value); state.waypoints.splice(options.at, 0, value); },
		async fetchByWaypoints() {
			if (mode === "failure") throw new Error("Routing failed");
			if (mode === "reroute") state.items[1].lng += 0.001;
			if (mode === "subdivision") {
				state.items.splice(1, 0, { ...calls[0].location });
				for (const waypoint of state.waypoints)
					waypoint.index = state.items.findIndex((point) => point.lat === waypoint.location.lat && point.lng === waypoint.location.lng);
			}
			if (mode === "missingName") state.waypoints[1].cnwName = "Lost";
			if (mode === "existingChanged") state.waypoints.at(-1).cnwName = "Changed";
		},
	};
	return { tour, events, calls, read: () => structuredClone(state) };
}
const poi = { id: "hills", kind: "hills", name: "Hills", distance: 55.5974633223, point: [23, 61.0005] },
	control = { cancelled: () => false, isCurrent: () => true };

test("native insertion uses unused IDs, verified icons and preserves existing POIs", async function () {
	const f = fixture("subdivision"), original = f.read();
	const result = await api.insert(f.tour, [poi], control);
	assert.equal(result.added, 1);
	assert.equal(f.calls[0].cnwId, 2);
	assert.equal(f.calls[0].cnwCategory, 43);
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
