import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const content = readFileSync(new URL("../content.js", import.meta.url), "utf8"),
	source = content.slice(content.indexOf("\tasync function shortcutWait("), content.indexOf("\tasync function refresh("));

function fixture() {
	let adapter, open = true, reopenCount = 0;
	const state = { heatmap: "None", sportMap: "Cycling", mapType: "Default" }, options = {};
	for (const label of ["None", "Global", "Personal"]) {
		options[label] = {
			isConnected: true,
			getAttribute() { return "false"; },
			click() {
				state.heatmap = label;
				this.isConnected = false;
				open = false;
			},
		};
	}
	const context = {
		console, Date, Promise,
		location: { pathname: "/tour/123/edit" },
		window: { addEventListener() {}, setTimeout, clearTimeout },
		document: { querySelector() {}, querySelectorAll() { return []; } },
		mapReady: true,
		extensionEnabled: true,
		contentSettings: { async getOptions() { return { rememberLayers: false }; } },
		globalThis: undefined,
		KrbMapShortcuts: {
			ShortcutError: Error,
			createController(value) { adapter = value; return {}; },
		},
	};
	delete context.globalThis;
	runInNewContext(source, context);
	context.withShortcutLayers = async function (operation) { return operation(); };
	context.shortcutLayerSheet = async function () { open = true; reopenCount++; };
	context.findLayerOption = function (kind, label) { return open ? options[label] : undefined; };
	context.selectedLayer = function (kind) { return open ? options[state[kind]] : undefined; };
	context.findHeatmapSport = function () { return undefined; };
	context.layerLabel = function (option) { return Object.keys(options).find((label) => options[label] === option); };
	return { adapter, state, context, reopenCount: () => reopenCount };
}

test("Personal heatmap is verified by reopening its closed chooser without requiring a sport-settings sheet", async function () {
	const f = fixture();
	assert.equal(await f.adapter.select({ heatmap: "Personal" }, { kind: "heatmap" }), "Personal");
	assert.equal(f.state.heatmap, "Personal");
	assert.equal(f.reopenCount(), 2);
});

test("heatmap restoration uses the same verified native control path", async function () {
	const f = fixture();
	await f.adapter.select({ heatmap: "Global" });
	assert.equal(f.state.heatmap, "Global");
	assert.equal(f.reopenCount(), 2);
});


test("shortcuts require a supported map page and pause while Settings is open", function () {
	const f = fixture();
	assert.equal(f.adapter.ready(), true);
	f.context.extensionEnabled = false;
	assert.equal(f.adapter.ready(), false);
	f.context.extensionEnabled = true;
	f.context.location.pathname = "/discover";
	assert.equal(f.adapter.ready(), false);
	f.context.location.pathname = "/plan";
	f.context.document.querySelector = function () { return {}; };
	assert.equal(f.adapter.ready(), false);
});
