import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("bundled Finland road references contain real segment geometry and E-road identities", function () {
	const context = {};
	for (const file of ["road-references-fi.js", "road-references-fi-part1.js", "road-references-fi-part2.js", "road-references-fi-part3.js"]) {
		const source = readFileSync(new URL("../" + file, import.meta.url), "utf8");
		assert.ok(Buffer.byteLength(source) < 5000000, `${file} exceeds Firefox parsing limit`);
		runInNewContext(source, context);
	}
	const { data, boundary } = context.KrbRoadReferencesFI;
	assert.equal(data.type, "FeatureCollection");
	assert.equal(data.features.length, 8900);
	assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(data.osmTimestamp));
	assert.ok(data.attribution.includes("OpenStreetMap"));
	assert.equal(boundary.type, "MultiPolygon");
	assert.ok(boundary.coordinates.length > 0);
	const european = new Set();
	for (const feature of data.features) {
		assert.equal(feature.geometry.type, "LineString");
		assert.ok(feature.geometry.coordinates.length >= 2);
		assert.ok(feature.properties.ref);
		for (const point of feature.geometry.coordinates) {
			assert.ok(Number.isFinite(point[0]) && Math.abs(point[0]) <= 180);
			assert.ok(Number.isFinite(point[1]) && Math.abs(point[1]) <= 90);
		}
		if (feature.properties.european) {
			for (const ref of feature.properties.european.split(" / ")) {
				assert.match(ref, /^E [1-9]\d{0,2}$/);
				european.add(ref);
			}
		}
	}
	for (const ref of ["E 4", "E 8", "E 12", "E 18", "E 45", "E 63", "E 75"]) assert.ok(european.has(ref));
});

test("road-reference data loads before the map bridge and is included in packaging", function () {
	const content = readFileSync(new URL("../content.js", import.meta.url), "utf8"),
		manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")),
		packaging = readFileSync(new URL("../scripts/build.mjs", import.meta.url), "utf8");
	assert.ok(content.indexOf('getURL("road-references-fi.js")') < content.indexOf('getURL("map-bridge.js")'));
	assert.ok(manifest.web_accessible_resources.some((entry) => entry.resources.includes("road-references-fi.js")));
	for (const file of ["road-references-fi.js", "road-references-fi-part1.js", "road-references-fi-part2.js", "road-references-fi-part3.js"]) {
		const position = content.indexOf(`"${file}"`);
		assert.ok(position >= 0 && position < content.indexOf('getURL("map-bridge.js")'));
		assert.ok(manifest.web_accessible_resources.some((entry) => entry.resources.includes(file)));
		assert.ok(packaging.includes(`"${file}"`));
	}
	assert.deepEqual(manifest.permissions, ["storage", "unlimitedStorage", "declarativeNetRequestWithHostAccess", "alarms"]);
});
