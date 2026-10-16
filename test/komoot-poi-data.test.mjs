import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const context = {};
runInNewContext(readFileSync(new URL("../komoot-poi-data.js", import.meta.url), "utf8"), context);
const api = context.KrbKomootPoiData;

test("Komoot coordinate profiles retain altitude and original indices without treating time as distance", function () {
	const items = [{ lat: 61, lng: 23, alt: 80, t: 0 }, { lat: 61, lng: 23, alt: 80, t: 10 },
		{ lat: 61.001, lng: 23, alt: 90, t: 40000 }, { lat: 61.002, lng: 23, t: 80000 }];
	const before = JSON.stringify(items);
	const result = api.readCoordinates(items);
	assert.equal(result.length, 3);
	assert.equal(result[1].index, 2);
	assert.ok(result[1].distance > 111 && result[1].distance < 112);
	assert.equal(result[1].elevation, 90);
	assert.equal(result[2].elevation, undefined);
	assert.equal(JSON.stringify(items), before);
	assert.throws(() => api.readCoordinates([{ lat: 61, lng: 23 }, { lat: 91, lng: 23 }]), /location/);
	assert.throws(() => api.readCoordinates([items[0], items[0]]), /travelled/);
});

test("custom named waypoint references retain inline or embedded names and categories", function () {
	const path = [{ reference: "cnw:1", index: 42, location: { lat: 61, lng: 23 }, name: "Halfway" },
		{ reference: "special:back", index: 100, location: { lat: 61, lng: 23 } }];
	const before = JSON.stringify(path);
	const result = api.readPath(path, [{ name: "Older name", category: "checkpoint", description: "Keep this" }]);
	assert.equal(result[0].name, "Halfway");
	assert.equal(result[0].category, "checkpoint");
	assert.equal(result[0].description, "Keep this");
	assert.equal(result[1].reference, "special:back");
	assert.equal(JSON.stringify(path), before);
});

test("approved POIs enforce the user name limit, uniqueness, location and category", function () {
	const poi = { id: "halfway", kind: "halfway", name: "Halfway", distance: 5000, point: [23, 61] };
	assert.equal(api.approved([poi])[0].categoryLabel, "Checkpoint");
	assert.throws(() => api.approved([{ ...poi, name: "A name far too long" }]), /invalid/);
	assert.throws(() => api.approved([poi, poi]), /invalid/);
	assert.throws(() => api.approved([{ ...poi, point: [181, 61] }]), /location/);
});


test("Gravel and Technical use Checkpoint and Danger while retaining concise approved names", function () {
	for (const kind of ["gravel", "technical"]) {
		const name = kind === "gravel" ? "Gravel" : "Technical";
		const pois = context.KrbKomootPoiData.approved([{ id: `${kind}:0`, kind, name, distance: 0, point: [23, 61] }]);
		assert.equal(pois[0].name, name);
		assert.equal(context.KrbKomootPoiData.categoryIds[kind], kind === "gravel" ? 35 : 5);
	}
});


test("approved Garmin-friendly categories agree with the page insertion mappings", function () {
	for (const [kind, name, category, label] of [
		["halfway", "Halfway", 35, "Checkpoint"],
		["gravel", "Gravel", 35, "Checkpoint"],
		["hills", "Hills", 35, "Checkpoint"],
		["trails", "Trails", 5, "Danger"],
		["technical", "Technical", 5, "Danger"],
	]) {
		const [poi] = api.approved([{ id: kind, kind, name, distance: 0, point: [23, 61] }]);
		assert.equal(poi.category, category);
		assert.equal(poi.categoryLabel, label);
	}
});
