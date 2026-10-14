import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const context = {};
runInNewContext(readFileSync(new URL("../ride-overview.js", import.meta.url), "utf8"), context);
runInNewContext(readFileSync(new URL("../route-check.js", import.meta.url), "utf8"), context);
runInNewContext(readFileSync(new URL("../komoot-poi-data.js", import.meta.url), "utf8"), context);
const api = context.KrbRideOverview;

test("Trails marks the first actual trail point and excludes short gaps from qualifying distance", function () {
	const points = profile(2000);
	for (const point of points) point.character = (point.distance >= 200 && point.distance < 500) || (point.distance >= 600 && point.distance < 800) ? "trail" : "paved";
	const poi = api.analyse(points).pois.find((entry) => entry.kind === "trails");
	assert.equal(poi.distance, 200);
	assert.equal(poi.end, 800);
	assert.equal(poi.trailDistance, 500);
	assert.deepEqual(Array.from(poi.point), Array.from(points[2].point));
	assert.ok(!api.analyse(points, { trailLength: 501 }).pois.some((entry) => entry.kind === "trails"));
	assert.ok(!api.analyse(points, { trailGap: 0 }).pois.some((entry) => entry.kind === "trails"));
});

test("native Komoot metadata covers gravel roads, paths and elevation without OSM matching", function () {
	const data = { distance: 90000, ascent: 650, coordinates: [{ lat: 61, lng: 23, alt: 80 }, { lat: 61.1, lng: 23, alt: 100 }, { lat: 61.2, lng: 23, alt: 120 }],
		wayTypes: [{ from: 0, to: 1, element: "wt#street" }, { from: 1, to: 2, element: "wt#way" }],
		surfaces: [{ from: 0, to: 1, element: "sb#gravel" }, { from: 1, to: 2, element: "sb#unpaved" }] };
	const result = api.analyse(api.fromKomoot(data));
	assert.equal(result.totalDistance, 90000);
	assert.equal(result.totals.unknown, 0);
	assert.ok(Math.abs(result.totals.gravel - 90000) < 0.01);
	assert.ok(result.totals.trail === 0);
	assert.ok(Math.abs(result.surfaceTotals.unpaved - 90000) < 0.01);
	assert.equal(result.elevationCoverage, 1);
	assert.equal(result.ascent, 650);
	const halfway = result.pois.find((poi) => poi.kind === "halfway");
	assert.equal(halfway.distance, 45000);
	assert.ok(halfway.geometryDistance < halfway.distance);
	assert.ok(Math.abs(halfway.point[1] - 61.1) < 0.000001);
});

test("only genuinely missing native metadata becomes unknown", function () {
	const result = api.analyse(api.fromKomoot({ coordinates: [{ lat: 61, lng: 23, alt: 80 }, { lat: 61.001, lng: 23, alt: 90 }],
		wayTypes: [{ from: 0, to: 1, element: "wt#cycleway" }], surfaces: [] }));
	assert.equal(result.totals.unknown, result.totalDistance);
	assert.equal(result.elevationCoverage, 1);
});

test("steep climbs use average gradient over the chosen length despite a brief flatter stretch", function () {
	const points = [0, 15, 15, 30].map(function (elevation, index) {
		return { distance: index * 100, point: [23, 61 + index / 1000], elevation };
	});
	const result = api.analyse(points, { smoothingDistance: 1, steepLength: 300, steepGradient: 8 });
	assert.equal(result.pois.filter((poi) => poi.kind === "steep").length, 1);
	assert.ok(result.sections.find((section) => section.kind === "steep").gradient > 8);
	assert.equal(api.analyse(points, { steepLength: 400 }).pois.some((poi) => poi.kind === "steep"), false);
});

test("verified Komoot altitude is interpolated onto route samples without inventing missing altitude", function () {
	const coordinates = [{ lat: 61, lng: 23, alt: 80 }, { lat: 61.001, lng: 23, alt: 90 }, { lat: 61.002, lng: 23 }];
	const route = { type: "FeatureCollection", features: [{ type: "Feature", properties: {},
		geometry: { type: "LineString", coordinates: coordinates.map((point) => [point.lng, point.lat]) } }] };
	const points = api.fromRoute(route, [], coordinates);
	assert.equal(points[0].elevation, 80);
	assert.ok(points.some((point) => point.elevation > 80 && point.elevation < 90));
	assert.equal(points.at(-1).elevation, undefined);
	assert.ok(api.analyse(points).elevationCoverage > 0);
	assert.throws(() => api.fromRoute(route, [], [coordinates[0], coordinates[1]]), /does not match/);
});
function profile(length, elevation, character = "unknown") {
	return Array.from({ length: length / 100 + 1 }, function (_, index) {
		return { distance: index * 100, point: [23 + index / 1000, 61], elevation: elevation?.(index * 100), character };
	});
}

test("halfway is by travelled distance, not vertex count, and analysis does not mutate inputs", function () {
	const points = [{ distance: 0, point: [0, 0] }, { distance: 100, point: [1, 0] }, { distance: 1000, point: [10, 0] }];
	const before = JSON.stringify(points),
		result = api.analyse(points);
	assert.equal(result.pois.length, 1);
	assert.equal(result.pois[0].name, "Halfway");
	assert.equal(result.pois[0].distance, 500);
	assert.equal(result.pois[0].point[0], 5);
	assert.equal(result.elevationCoverage, 0);
	assert.equal(result.ascent, 0);
	assert.equal(JSON.stringify(points), before);
});

test("sustained trail stretches create only start POIs with concise names", function () {
	const result = api.analyse(profile(6000, undefined, "trail"));
	assert.equal(result.totals.trail, 6000);
	assert.equal(result.pois.filter((p) => p.kind === "trails").length, 1);
	assert.equal(result.pois[0].name, "Trails");
	assert.ok(result.pois.every((p) => p.name.length <= 16));
	assert.equal(api.analyse(profile(500, undefined, "trail")).pois.length, 2);
	assert.equal(api.analyse(profile(1000, undefined, "track")).pois.length, 1);
});

test("ascent concentration and steep climbing are detected independently", function () {
	const hills = api.analyse(profile(5000, (distance) => distance * 0.04));
	assert.ok(hills.pois.some((p) => p.name === "Hills"));
	assert.ok(!hills.pois.some((p) => p.name === "Steep climb"));
	const steep = api.analyse(profile(1000, (distance) => distance * 0.12));
	assert.ok(steep.pois.some((p) => p.name === "Steep climb"));
	assert.ok(!steep.pois.some((p) => p.name === "Hills"));
	assert.ok(!api.analyse(profile(1000, (distance) => -distance * 0.12)).pois.some((p) => p.kind === "steep"));
});

test("missing elevation does not become a flat profile or an ascent claim across a gap", function () {
	const points = profile(3000, (distance) => distance * 0.1);
	points[15].elevation = undefined;
	const result = api.analyse(points, { hillAscent: 250 });
	assert.ok(result.elevationCoverage < 1);
	assert.ok(!result.pois.some((p) => p.kind === "hills"));
});

test("invalid profiles fail and adjustable thresholds alter the generated suggestions", function () {
	assert.throws(() => api.analyse([{ distance: 0, point: [0, 0] }, { distance: 0, point: [1, 0] }]), /unordered/);
	assert.equal(api.preferences({ steepGradient: -1 }).steepGradient, 8);
	assert.ok(!api.analyse(profile(1000, (d) => d * 0.12), { steepGradient: 15 }).pois.some((p) => p.kind === "steep"));
});


test("trail gaps at the limit join, longer gaps and geometry breaks split clusters", function () {
	function points(gap, broken = false) {
		return [
			{ distance: 0, point: [23, 61], character: "trail", breakAfter: broken },
			{ distance: 300, point: [23.003, 61], character: "unknown" },
			{ distance: 300 + gap, point: [23.004, 61], character: "trail" },
			{ distance: 600 + gap, point: [23.007, 61] },
		];
	}
	assert.equal(api.analyse(points(150)).pois.filter((p) => p.kind === "trails").length, 1);
	assert.equal(api.analyse(points(151)).pois.filter((p) => p.kind === "trails").length, 0);
	assert.equal(api.analyse(points(150, true)).pois.filter((p) => p.kind === "trails").length, 0);
	assert.equal(api.analyse(profile(400, undefined, "trail")).pois.filter((p) => p.kind === "trails").length, 0);
	assert.equal(api.analyse(profile(400, undefined, "trail"), { trailLength: 400 }).pois.filter((p) => p.kind === "trails").length, 1);
});

test("separate qualifying trail blocks get separate starts without trailing road distance", function () {
	const points = profile(2000);
	for (const point of points) point.character = (point.distance < 500 || (point.distance >= 1000 && point.distance < 1500)) ? "trail" : "paved";
	const pois = api.analyse(points).pois.filter((p) => p.kind === "trails");
	assert.deepEqual(Array.from(pois, (p) => [p.distance, p.end, p.trailDistance]), [[0, 500, 500], [1000, 1500, 500]]);
});

test("overlapping qualifying hills windows merge into a single named section", function () {
	const result = api.analyse(profile(15000, (distance) => distance * 0.04));
	const hills = result.sections.filter((s) => s.kind === "hills");
	assert.equal(hills.length, 1);
	assert.equal(hills[0].end, 15000);
	assert.ok(hills[0].ascent > 590);
});


test("route adapter uses conservative matching and leaves unavailable elevation unknown", function () {
	const coordinates = [[23, 61], [23.01, 61]],
		route = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } },
		way = { type: "Feature", id: "way/1", properties: { osmId: "way/1", highway: "track", surface: "dirt" }, geometry: { type: "LineString", coordinates } };
	const points = api.fromRoute(route, [way]),
		result = api.analyse(points);
	assert.ok(result.totals.track > 500);
	assert.equal(result.elevationCoverage, 0);
	assert.equal(api.analyse(api.fromRoute(route)).totals.track, 0);
});

test("character timeline covers all route distance including unknown gaps", function () {
	const points = profile(6000);
	for (let index = 0; index < 10; index++) points[index].character = "paved";
	for (let index = 10; index < 30; index++) points[index].character = "trail";
	const result = api.analyse(points);
	assert.deepEqual(Array.from(result.characterSections, (s) => s.character), ["paved", "trail", "unknown"]);
	assert.equal(result.characterSections.reduce((sum, s) => sum + s.end - s.start, 0), result.totalDistance);
	assert.equal(result.characterSections.at(-1).end, 6000);
});

test("halfway interpolation stays on actual geometry across disconnected route parts", function () {
	const route = { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: [
		[[23, 61], [23.001, 61]], [[24, 61], [24.01, 61]],
	] } };
	const points = api.fromRoute(route), result = api.analyse(points);
	assert.ok(points.some((p) => p.breakAfter));
	assert.ok(result.pois.find((p) => p.kind === "halfway").point[0] > 24);
});

test("ride description explains thirds without treating missing elevation as flat", function () {
	const points = profile(9000);
	for (let index = 0; index < 30; index++) points[index].character = "paved";
	for (let index = 30; index < 60; index++) points[index].character = "track";
	const text = api.describe(api.analyse(points));
	assert.match(text, /first third is mostly paved/);
	assert.match(text, /middle third is mostly tracks/);
	assert.match(text, /final third is mostly of unknown character/);
	assert.match(text, /elevation is missing/);
});


test("third descriptions keep native surface and way type independent", function () {
	const points = profile(9000);
	for (const point of points) {
		point.surfaceGroup = point.distance < 3000 ? "paved" : "unpaved";
		point.character = point.surfaceGroup;
		point.wayType = point.distance < 3000 ? "wt#cycleway" : "wt#street";
	}
	const text = api.describe(api.analyse(points));
	assert.match(text, /first third is mostly paved, mainly cycleways/);
	assert.match(text, /rest is mostly unpaved, mainly roads/);
	assert.doesNotMatch(text, /middle third|final third|Way types in this third/);
	assert.equal((text.match(/cycleways/g) || []).length, 1);
});


test("native compacted gravel paths are Gravel rather than Trails", function () {
	const data = { distance: 2500, coordinates: [{ lat: 61, lng: 23 }, { lat: 61.01, lng: 23 }],
		surfaces: [{ from: 0, to: 1, element: "sb#compacted" }], wayTypes: [{ from: 0, to: 1, element: "wt#way" }] };
	const result = api.analyse(api.fromKomoot(data));
	assert.equal(result.totals.gravel, 2500);
	assert.equal(result.totals.trail, 0);
	assert.equal(result.totals.technical, 0);
	assert.equal(result.missingMtbDistance, 2500);
	assert.equal(result.pois.find((poi) => poi.kind === "gravel").name, "Gravel");
	assert.ok(!result.pois.some((poi) => poi.kind === "trails"));
});

test("native singletrack grades distinguish S0 Trails from S1–S5 Technical", function () {
	for (let grade = 0; grade <= 5; grade++) {
		const data = { distance: 1000, coordinates: [{ lat: 61, lng: 23 }, { lat: 61.01, lng: 23 }],
			surfaces: [{ from: 0, to: 1, element: "sb#ground" }], wayTypes: [{ from: 0, to: 1, element: `wt#trail_d${[1, 2, 3, 5, 6, 7][grade]}` }] };
		const points = api.fromKomoot(data), result = api.analyse(points);
		assert.equal(points[0].mtbGrade, grade);
		assert.equal(points[0].mtbSource, "Komoot");
		assert.equal(result.totals[grade ? "technical" : "trail"], 1000);
		assert.equal(result.missingMtbDistance, 0);
		assert.ok(result.pois.some((poi) => poi.name === (grade ? "Technical" : "Trails")));
	}
});

test("missing native grades reuse conservative checker matching without replacing Komoot surface or way type", function () {
	const coordinates = [[23, 61], [23, 61.01]],
		data = { distance: 1000, coordinates: coordinates.map(([lng, lat]) => ({ lng, lat })), surfaces: [{ from: 0, to: 1, element: "sb#compacted" }], wayTypes: [{ from: 0, to: 1, element: "wt#way" }] },
		feature = { type: "Feature", properties: { osmId: "way/1", highway: "path", surface: "dirt", trailRating: "S2" }, geometry: { type: "LineString", coordinates } };
	const fallback = api.fromKomoot(data, [feature]);
	assert.equal(fallback[0].mtbGrade, 2);
	assert.equal(fallback[0].mtbSource, "OSM");
	assert.equal(fallback[0].surface, "sb#compacted");
	assert.equal(fallback[0].wayType, "wt#way");
	data.wayTypes[0].element = "wt#trail_d1";
	const native = api.fromKomoot(data, [feature]);
	assert.equal(native[0].mtbGrade, 0);
	assert.equal(native[0].character, "trail");
	data.wayTypes[0].element = "wt#cycleway";
	assert.equal(api.fromKomoot(data, [feature])[0].character, "gravel");
	data.wayTypes[0].element = "wt#way";
	feature.properties.trailRating = "S0";
	assert.equal(api.fromKomoot(data, [feature])[0].character, "trail");
	feature.geometry.coordinates = [[23.001, 61], [23.001, 61.01]];
	assert.equal(api.fromKomoot(data, [feature])[0].mtbGrade, undefined);
});

test("Gravel has a higher adjustable minimum than Trails and Technical", function () {
	assert.ok(!api.analyse(profile(1500, undefined, "gravel")).pois.some((poi) => poi.kind === "gravel"));
	assert.ok(api.analyse(profile(2000, undefined, "gravel")).pois.some((poi) => poi.kind === "gravel"));
	assert.ok(api.analyse(profile(1500, undefined, "gravel"), { gravelLength: 1500 }).pois.some((poi) => poi.kind === "gravel"));
	assert.ok(api.analyse(profile(500, undefined, "technical")).pois.some((poi) => poi.kind === "technical"));
	assert.ok(!api.analyse(profile(500, undefined, "technical"), { technicalLength: 600 }).pois.some((poi) => poi.kind === "technical"));
});


test("Komoot d4 shares the native S2 caption and unrecognized grade tokens never become S0", function () {
	const data = { distance: 1000, coordinates: [{ lat: 61, lng: 23 }, { lat: 61.01, lng: 23 }], surfaces: [{ from: 0, to: 1, element: "sb#ground" }], wayTypes: [{ from: 0, to: 1, element: "wt#trail_d4" }] };
	assert.equal(api.fromKomoot(data)[0].mtbGrade, 2);
	data.wayTypes[0].element = "wt#trail_d99";
	assert.equal(api.fromKomoot(data)[0].mtbGrade, undefined);
	assert.equal(api.fromKomoot(data)[0].character, "gravel");
	data.wayTypes[0].element = "wt#trail";
	assert.equal(api.fromKomoot(data)[0].character, "trail");
	assert.equal(api.fromKomoot(data)[0].mtbGrade, undefined);
});


test("highlight geometry follows native corners and interpolates exact section endpoints", function () {
	const data = { distance: 2000, coordinates: [{ lat: 61, lng: 23 }, { lat: 61.01, lng: 23.01 }, { lat: 61.02, lng: 23 }] },
		points = api.fromKomoot(data), whole = api.sectionCoordinates(points, 0, 2000), section = api.sectionCoordinates(points, 500, 1500);
	assert.equal(whole.length, 3);
	assert.equal(section.length, 3);
	assert.deepEqual(Array.from(section[1]), [23.01, 61.01]);
	assert.ok(section[0][1] > 61 && section[0][1] < 61.01);
	assert.ok(section[2][1] > 61.01 && section[2][1] < 61.02);
	assert.throws(() => api.sectionCoordinates(points, 1500, 1000), /Invalid section/);
	points[50].breakAfter = true;
	assert.throws(() => api.sectionCoordinates(points, 0, 2000), /disconnected/);
});


test("nearby Hills and Steep climb findings remain visible but share one climb POI", function () {
	const result = api.analyse(profile(3000, (distance) => distance * 0.12));
	assert.ok(result.sections.some((section) => section.kind === "hills"));
	assert.ok(result.sections.some((section) => section.kind === "steep"));
	assert.equal(result.pois.filter((poi) => ["hills", "steep"].includes(poi.kind)).length, 1);
	assert.deepEqual(Array.from(result.pois.find((poi) => poi.kind === "steep").relatedKinds), ["hills"]);
});

test("main climbing completion uses 95 percent of known ascent and never invents it across missing elevation", function () {
	const points = profile(10000, (distance) => Math.min(distance, 3000) * 0.1);
	const result = api.analyse(points);
	assert.ok(result.climbingFinish >= 2800 && result.climbingFinish <= 3100);
	assert.match(api.describe(result), /Most climbing is behind you by/);
	points[70].elevation = undefined;
	assert.equal(api.analyse(points).climbingFinish, undefined);
	assert.ok(!result.pois.some((poi) => poi.name === "Summit"));
});

test("mixed character suggestions explain their share and have explicit reasons", function () {
	const points = profile(1200);
	for (const point of points) point.character = point.distance < 600 || point.distance >= 700 ? "trail" : "gravel";
	const poi = api.analyse(points).pois.find((item) => item.kind === "trails");
	assert.equal(poi.characterDistance, 1100);
	assert.ok(Math.abs(poi.share - 11 / 12) < 0.000001);
	assert.match(poi.reason, /sustained trail/);
	assert.ok(!api.analyse(points).pois.some((item) => item.kind === "gravel"));
});

test("existing POIs require matching name, route progress and location", function () {
	const poi = { kind: "gravel", name: "Gravel", point: [23, 61], geometryDistance: 2000 },
		existing = { name: "Gravel", category: 24, point: [23, 61], geometryDistance: 2000 };
	assert.equal(api.markExisting([poi], [existing])[0].alreadyPresent, true);
	for (const change of [{ name: "Trails" }, { geometryDistance: 4000 }, { point: [24, 61] }, { point: [NaN, 61] }])
		assert.equal(api.markExisting([poi], [{ ...existing, ...change }])[0].alreadyPresent, false);
	assert.equal(api.markExisting([poi], [{ ...existing, name: " gravel ", category: 35 }])[0].alreadyPresent, true);
	assert.equal(poi.alreadyPresent, undefined);
});

test("surface and way-type breakdowns stay independent and aggregate native singletrack grades", function () {
	const ways = api.breakdown({ "wt#trail_d1": 500, "wt#trail_d3": 500, "wt#cycleway": 2000, unknown: 100 }, "way");
	assert.equal(ways.find((entry) => entry.label === "Singletrack").distance, 1000);
	assert.equal(ways[0].label, "Cycleways");
	const surfaces = api.breakdown({ "sb#compacted": 2000, "sb#asphalt": 1000, "sb#new": 100 }, "surface");
	assert.equal(surfaces[0].label, "Compacted gravel");
	assert.equal(surfaces.find((entry) => entry.label === "Unknown").distance, 100);
	assert.ok(!surfaces.some((entry) => entry.label === "Cycleways"));
});

test("section copy explains short interruptions and preserves peak sustained climb difficulty", function () {
	assert.match(api.sectionDetail({ kind: "gravel", characterDistance: 2500, otherCharacters: ["trail"] }), /2.5 km of gravel or dirt, with short trail stretches/);
	assert.match(api.sectionDetail({ kind: "steep", gradient: 6, peakGradient: 12 }), /12.0% strongest sustained gradient/);
	assert.match(api.sectionDetail({ kind: "hills", ascent: 250 }), /250 m of climbing/);
});


test("different S grades still form a mostly singletrack third", function () {
	const points = profile(9000);
	for (const point of points) {
		point.surfaceGroup = "unpaved";
		point.wayType = point.distance % 3000 < 1500 ? "wt#trail_d1" : "wt#trail_d3";
	}
	assert.match(api.describe(api.analyse(points)), /The ride is mostly unpaved, mainly singletrack/);
});


test("native ascent and profile coverage are independent and even small elevation gaps prohibit a climbing-finish claim", function () {
	const points = profile(1000000, (distance) => Math.min(distance, 3000) * 0.1);
	points[0].nativeAscent = 650;
	points[700].elevation = undefined;
	const result = api.analyse(points);
	assert.equal(result.ascent, 650);
	assert.ok(result.elevationCoverage > 0.999);
	assert.equal(result.ascentSource, "Komoot");
	assert.equal(result.ascentAvailable, true);
	assert.equal(result.climbingFinish, undefined);
	assert.match(api.describe(result), /elevation is missing/);
	assert.doesNotMatch(api.describe(result, { includeCoverage: false }), /elevation is missing/);
});


test("Hills starts at actual climbing rather than the flat lead-in of a qualifying window", function () {
	const points = profile(6000, (distance) => Math.max(0, Math.min(distance - 3000, 2000)) * 0.12),
		result = api.analyse(points);
	const hills = result.sections.find((section) => section.kind === "hills");
	assert.ok(hills.start >= 2900 && hills.start <= 3000);
	assert.ok(hills.ascent >= 200);
	assert.ok(!result.pois.some((poi) => poi.kind === "hills"));
	assert.ok(result.pois.find((poi) => poi.kind === "steep").relatedKinds.includes("hills"));
});


test("missing MTB ranges remain separate across rated portions and exclude unrelated road gaps", function () {
	const points = profile(2000);
	for (const point of points) {
		point.mtbEligible = point.distance < 500 || (point.distance >= 1000 && point.distance < 1400);
	}
	const result = api.analyse(points);
	assert.equal(result.missingMtbDistance, 900);
	assert.deepEqual(Array.from(result.missingMtbSections, (section) => [section.start, section.end]), [[0, 500], [1000, 1400]]);
	points[2].mtbGrade = 0;
	const rated = api.analyse(points);
	assert.equal(rated.missingMtbDistance, 800);
	assert.deepEqual(Array.from(rated.missingMtbSections, (section) => [section.start, section.end]), [[0, 200], [300, 500], [1000, 1400]]);
});
