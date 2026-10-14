import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../map-bridge.js", import.meta.url), "utf8"),
	reader = source.slice(source.indexOf("\tfunction rideCoordinates("), source.indexOf("\tfunction routeSnapshot("));

test("active editor profile is independent of duplicated rendered overlays", function () {
	const items = [{ lat: 61, lng: 23, alt: 80 }, { lat: 61.001, lng: 23, alt: 90 }],
		tour = { attributes: { type: "tour_planned" }, link: () => ({ get: () => items }) },
		context = { document: { querySelectorAll: () => [{ "__reactFiber$test": { memoizedProps: { page: {}, tour } } }] }, Node: class Node {}, window: {} };
	runInNewContext(`${reader}\nthis.read = rideCoordinates;`, context);
	const overlays = { features: [{ geometry: { type: "LineString", coordinates: [[23, 61], [23.001, 61], [23, 61]] } }] };
	assert.equal(context.read(overlays).length, 2);
	assert.equal(context.read(overlays)[1].alt, 90);
	assert.equal(context.read(overlays, true), tour);
});

function read(route, coordinates) {
	const root = { attributes: { type: "tour_planned" }, link: () => ({ get: () => coordinates }) };
	Object.defineProperty(root, "unsafeGetter", { get: function () { throw new Error("Getter should not run"); } });
	const context = { document: { querySelectorAll: () => [{ "__reactFiber$test": { memoizedProps: { tour: root } } }] },
		Node: class Node {}, window: {} };
	runInNewContext(`${reader}\nthis.read = rideCoordinates;`, context);
	return context.read(route);
}

test("bridge accepts only the profile matching all rendered coordinates, including shared segment endpoints", function () {
	const route = { features: [{ geometry: { type: "LineString", coordinates: [[23, 61], [23.001, 61]] } },
		{ geometry: { type: "LineString", coordinates: [[23.001, 61], [23.002, 61]] } }] };
	const coordinates = [{ lat: 61, lng: 23, alt: 80, t: 0 }, { lat: 61, lng: 23.001, alt: 85, t: 10 },
		{ lat: 61, lng: 23.002, alt: 90, t: 20 }];
	const result = read(route, coordinates);
	assert.equal(result.length, 3);
	assert.equal(result[1].alt, 85);
	assert.equal(Object.hasOwn(result[1], "t"), false);
	assert.equal(read(route, coordinates.slice(0, 2)), undefined);
	assert.equal(read(route, [coordinates[0], { ...coordinates[1], lng: 24 }, coordinates[2]]), undefined);
});
