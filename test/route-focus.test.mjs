import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const source = readFileSync(new URL("../map-bridge.js", import.meta.url), "utf8"),
	start = source.indexOf('\t\tif (event.data?.type === "KRB_ROUTE_FOCUS"'),
	handler = source.slice(start, source.indexOf("\n\t});", start));
function fixture({ reducedMotion = false } = {}) {
	const sources = [], layers = [], cameras = [];
	let previewClears = 0;
	const context = {
		checkedRouteKey: "current", checkRouteChanged() {}, clearRouteHighlight() {}, console,
		window: { innerWidth: 1200, matchMedia: () => ({ matches: reducedMotion }) }, setTimeout() { return 1; }, routeHighlightTimer: undefined,
		routePreviewId: undefined, routePreviewTimer: undefined,
		clearRoutePreview() { previewClears++; context.routePreviewId = undefined; },
		map: {
			addSource(id, value) { sources.push(value); }, addLayer(value) { layers.push(value); },
			getContainer: () => ({ clientWidth: 1000 }), getZoom: () => 12,
			fitBounds(bounds, options) { cameras.push({ bounds, options }); },
			easeTo(options) { cameras.push({ options }); },
		},
	};
	runInNewContext(`this.focus = function (event) { ${handler} };`, context);
	return { sources, layers, cameras, previewClears: () => previewClears, focus: (data) => context.focus({ data: { type: "KRB_ROUTE_FOCUS", ...data } }) };
}
const coordinates = [[23, 61], [23.01, 61.001], [23.005, 61.01]], point = coordinates[0];
test("section focus highlights its geometry and fits the whole section with bounded panel padding", function () {
	const f = fixture();
	f.focus({ routeKey: "current", point, coordinates, fitSection: true, paddingRight: 508 });
	assert.equal(f.sources[0].data.geometry.coordinates, coordinates);
	assert.equal(f.layers.length, 1);
	assert.deepEqual(JSON.parse(JSON.stringify(f.cameras[0].bounds)), [[23, 61], [23.01, 61.01]]);
	assert.equal(f.cameras[0].options.padding.right, 450);
	assert.equal(f.cameras[0].options.maxZoom, 17);
});
test("existing warning focus keeps close zoom and stale or invalid section requests do nothing", function () {
	const f = fixture();
	f.focus({ routeKey: "old", point, coordinates, fitSection: true });
	f.focus({ routeKey: "current", point, coordinates: [[NaN, 61], point], fitSection: true });
	assert.equal(f.sources.length, 0);
	f.focus({ routeKey: "current", point, coordinates });
	assert.equal(f.sources.length, 1);
	assert.equal(f.cameras[0].options.zoom, 16);
	assert.equal(f.cameras[0].options.center, point);
});


test("hover preview highlights without moving the map and stale leave events cannot clear a newer preview", function () {
	const f = fixture();
	f.focus({ routeKey: "current", point, coordinates, previewOnly: true, previewId: "first", fitSection: true });
	assert.equal(f.layers[0].id, "krb-route-preview");
	assert.equal(f.cameras.length, 0);
	f.focus({ routeKey: "current", point, coordinates, previewOnly: true, previewId: "second" });
	const clears = f.previewClears();
	f.focus({ routeKey: "current", clearPreview: true, previewId: "first" });
	assert.equal(f.previewClears(), clears);
	f.focus({ routeKey: "current", clearPreview: true, previewId: "second" });
	assert.equal(f.previewClears(), clears + 1);
	f.focus({ routeKey: "stale", point, coordinates, previewOnly: true, previewId: "third" });
	assert.equal(f.layers.length, 2);
});

test("reduced motion disables animated section and warning camera movement", function () {
	const f = fixture({ reducedMotion: true });
	f.focus({ routeKey: "current", point, coordinates, fitSection: true });
	f.focus({ routeKey: "current", point, coordinates });
	assert.equal(f.cameras[0].options.duration, 0);
	assert.equal(f.cameras[1].options.duration, 0);
});


test("scattered missing-grade previews use separate lines without camera movement or joining gaps", function () {
	const f = fixture(), sections = [coordinates, [[24, 62], [24.01, 62.01]]];
	f.focus({ routeKey: "current", point, coordinates, previewOnly: true, previewId: "grades", sections });
	assert.equal(f.sources[0].data.geometry.type, "MultiLineString");
	assert.equal(f.sources[0].data.geometry.coordinates, sections);
	assert.equal(f.cameras.length, 0);
	const count = f.sources.length;
	f.focus({ routeKey: "current", point, coordinates, previewOnly: true, previewId: "bad", sections: [[[NaN, 61], point]] });
	f.focus({ routeKey: "current", point, coordinates, fitSection: true, sections });
	assert.equal(f.sources.length, count);
});
