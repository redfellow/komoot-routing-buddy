import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const context = { Set, setTimeout };
runInNewContext(readFileSync(new URL("../squadrats-estimate.js", import.meta.url), "utf8"), context);
const api = context.KrbSquadratsEstimate;
function block(width, height, startX = 10, startY = 10) {
	return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => `${x + startX}-${y + startY}`)).flat();
}
function data(visited, planned, small = { zoom: 17, visited: [], planned: [] }) {
	return { status: "ready", grids: [{ zoom: 14, visited, planned }, small] };
}
function plain(value) {
	return JSON.parse(JSON.stringify(value));
}

test("new tile counts are unique and independent at each grid size", async function () {
	const value = await api.estimate(data(["10-10"], ["10-10", "11-10", "11-10"], { zoom: 17, visited: ["80-80"], planned: ["81-80", "82-80", "81-80"] }));
	assert.equal(value[0].gained.count, 1);
	assert.equal(value[1].gained.count, 2);
	assert.equal(value[0].gained.yard, 0);
});

test("a connecting tile grows the largest Yard by merging previously separate interiors", async function () {
	const full = block(7, 3), visited = full.filter((key) => key !== "13-11");
	const value = (await api.estimate(data(visited, ["13-11"])))[0];
	assert.equal(value.before.yard, 1);
	assert.equal(value.after.yard, 5);
	assert.equal(value.gained.yard, 4);
	assert.equal(value.gained.count, 1);
});

test("Yardinho and Übersquadratinho growth use the smaller collection", async function () {
	const full = block(3, 3), visited = full.filter((key) => key !== "12-12");
	const value = (await api.estimate(data([], [], { zoom: 17, visited, planned: ["12-12"] })))[1];
	assert.equal(value.before.square, 2);
	assert.equal(value.after.square, 3);
	assert.equal(value.gained.square, 1);
	assert.equal(value.gained.yard, 0);
	const yard = (await api.estimate(data([], [], { zoom: 17, visited: block(3, 3).filter((key) => key !== "11-10"), planned: ["11-10"] })))[1];
	assert.equal(yard.gained.yard, 1);
});

test("diagonal-only contacts do not connect Yards and gaps cannot form a filled square", async function () {
	const value = (await api.estimate(data(["10-10", "11-11", "12-12"], [])))[0];
	assert.equal(value.after.square, 1);
	assert.equal(value.after.yard, 0);
	const separated = [...block(3, 3), ...block(3, 3, 13, 13)];
	assert.equal((await api.estimate(data(separated, [])))[0].after.yard, 1);
});

test("growth elsewhere cannot reduce an existing larger Yard or square", async function () {
	const value = (await api.estimate(data([...block(6, 6), ...block(3, 3, 100, 100).filter((key) => key !== "102-102")], ["102-102"])))[0];
	assert.equal(value.before.yard, 16);
	assert.equal(value.gained.yard, 0);
	assert.equal(value.gained.square, 0);
});

test("no new tiles and a confirmed empty collection are distinct from unavailable data", async function () {
	const value = await api.estimate(data(["10-10"], ["10-10"], { zoom: 17, error: "Collection not loaded" }));
	assert.deepEqual(plain(value[0].gained), { count: 0, yard: 0, square: 0 });
	assert.match(value[1].error, /not loaded/);
	assert.equal((await api.estimate(data([], ["10-10"])))[0].gained.count, 1);
});

test("malformed and oversized data fail explicitly without fake zero gains", async function () {
	for (const visited of [["unknown"], ["16384-1"], ["-1-1"], [1], new Array(api.LIMIT + 1)]) {
		const value = await api.estimate(data(visited, []));
		assert.ok(value[0].error);
		assert.equal(value[0].gained, undefined);
	}
});

test("sparse world-spanning tiles do not allocate their enormous bounding box", async function () {
	const value = await api.estimate(data(["0-0", "16383-16383"], [], { zoom: 17, visited: ["0-0", "131071-131071"], planned: [] }));
	assert.equal(value[0].after.square, 1);
	assert.equal(value[1].after.square, 1);
});

test("large collections yield to the event loop and can be cancelled", async function () {
	const controller = new AbortController(), operation = api.estimate(data(block(200, 100), []), controller.signal);
	setTimeout(() => controller.abort(), 0);
	await assert.rejects(operation, { name: "AbortError" });
});

test("adapter uses the native route tiler without mutating collections or making requests", function () {
	const calls = [], raw = { 14: new Set(["10-10"]), 17: new Set() }, provider = { enabled: true, raw },
		adapter = { provider, encode(points) { calls.push(points); return "encoded"; }, tiler: { getSquadrats(paths, zoom) { calls.push({ paths, zoom }); return new Set(["11-10"]); } } };
	const result = api.read(adapter, [{ lng: 23, lat: 61 }, { lng: 24, lat: 61 }]);
	assert.equal(result.status, "ready");
	assert.deepEqual(plain(calls), [[23, 61, 24, 61], { paths: ["encoded"], zoom: 14 }, { paths: ["encoded"], zoom: 17 }]);
	assert.deepEqual([...raw[14]], ["10-10"]);
	assert.equal(raw[17].size, 0);
	assert.equal(result.grids[1].visited.length, 0);
	delete raw[17];
	assert.equal(api.read(adapter, [{ lng: 23, lat: 61 }, { lng: 24, lat: 61 }]).grids[1].error, "Collection not loaded");
	assert.equal(api.read({ provider: { enabled: false } }, []).status, "unavailable");
	assert.equal(api.read({}, []).status, "unavailable");
});
