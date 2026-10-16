import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const context = { console };
runInNewContext(readFileSync(new URL("../content.js", import.meta.url), "utf8").split("// Keyboard commands")[1].split("// End keyboard controller.")[0].replace(/^.*\n/, ""), context);
const api = context.KrbMapShortcuts;
function key(value, overrides = {}) {
	return { key: value, target: {}, prevented: false, stopped: false,
		preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...overrides };
}
function fixture() {
	let ready = true, inspect = false, failSatellite = false, failRestore = false,
		state = { mapType: "NLS Map", sportMap: "MTB", heatmap: "Personal" };
	const initial = { ...state }, notices = [], writes = [];
	const controller = api.createController({
		ready: () => ready,
		async snapshot() { return { ...state }; },
		async select(next) {
			if (next.mapType === "Satellite" && failSatellite) throw new Error("Satellite unavailable");
			if (next.mapType === "NLS Map" && failRestore) throw new Error("Restore unavailable");
			state = { ...state, ...next };
			writes.push({ ...next });
		},
		inspect(value) { inspect = value; },
		announce(text) { notices.push(text); },
	});
	return { controller, initial, notices, writes, state: () => state, inspect: () => inspect,
		ready(value) { ready = value; }, failSatellite() { failSatellite = true; }, failRestore(value) { failRestore = value; } };
}

test("keyboard mappings cover maps and sport maps while leaving ASD to Komoot", function () {
	assert.equal(api.command(key("1")).label, "Default");
	assert.equal(api.command(key("2")).label, "NLS Map");
	assert.equal(api.command(key("3")).label, "Satellite");
	assert.equal(api.command(key("4")).label, "OpenStreetMap");
	assert.equal(api.command(key("5")).label, "OpenCycleMap");
	for (const [index, value] of Array.from("qwert").entries()) assert.equal(api.command(key(value)).index, index);
	assert.equal(api.command(key("a")), undefined);
	assert.equal(api.command(key("s")), undefined);
	assert.equal(api.command(key("d")), undefined);
});

test("typing, controls, composed paths, repeated keys and modifiers retain native behavior", function () {
	for (const overrides of [{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { isComposing: true }, { defaultPrevented: true },
		{ target: { isContentEditable: true } }, { target: { closest: () => ({}) } }, { composedPath: () => [{ isContentEditable: true }] }])
		assert.equal(api.command(key(" ", overrides)), undefined);
	assert.equal(api.command(key("z")), undefined);
});

test("two rapid Space presses restore the actual previous view and overlay state", async function () {
	const f = fixture(), first = key(" ");
	f.controller.handle(first);
	f.controller.handle(key(" "));
	await f.controller.idle();
	assert.equal(first.prevented, true);
	assert.equal(first.stopped, true);
	assert.deepEqual(f.state(), f.initial);
	assert.equal(f.inspect(), false);
	assert.equal(f.controller.active(), false);
	assert.equal(f.writes.length, 2);
});

test("satellite mode thins and hides overlays until Space restores them", async function () {
	const f = fixture();
	f.controller.handle(key(" "));
	await f.controller.idle();
	assert.equal(f.state().mapType, "Satellite");
	assert.equal(f.state().heatmap, "None");
	assert.equal(f.state().sportMap, "None");
	assert.equal(f.inspect(), true);
	assert.equal(f.controller.active(), true);
	f.controller.handle(key("4"));
	await f.controller.idle();
	assert.equal(f.state().mapType, "OpenStreetMap");
	assert.equal(f.state().sportMap, "MTB");
	assert.equal(f.state().heatmap, "Personal");
	assert.equal(f.inspect(), false);
});

test("failed entry rolls back; failed restoration keeps its snapshot for another Space press", async function () {
	const f = fixture();
	f.failSatellite();
	f.controller.handle(key(" "));
	await f.controller.idle();
	assert.deepEqual(f.state(), f.initial);
	assert.equal(f.inspect(), false);
	assert.match(f.notices.at(-1), /Satellite unavailable/);
	const g = fixture();
	g.controller.handle(key(" "));
	await g.controller.idle();
	g.failRestore(true);
	g.controller.handle(key(" "));
	await g.controller.idle();
	assert.equal(g.controller.active(), true);
	g.failRestore(false);
	g.controller.handle(key(" "));
	await g.controller.idle();
	assert.deepEqual(g.state(), g.initial);
	assert.equal(g.inspect(), false);
});

test("shortcuts wait for a ready map without consuming unrelated keys", async function () {
	const f = fixture(), event = key(" ");
	f.ready(false);
	assert.equal(f.controller.handle(event), false);
	assert.equal(event.prevented, false);
	assert.equal(f.controller.handle(key("z")), false);
	await f.controller.idle();
	assert.equal(f.writes.length, 0);
});


test("switching Off cancels queued keys and restores an active inspection", async function () {
	const f = fixture();
	f.controller.handle(key(" "));
	await f.controller.idle();
	f.controller.handle(key("4"));
	f.ready(false);
	await f.controller.suspend();
	assert.deepEqual(f.state(), f.initial);
	assert.equal(f.inspect(), false);
	const event = key("3");
	assert.equal(f.controller.handle(event), false);
	assert.equal(event.prevented, false);
});


test("map keys work from ordinary buttons while Space retains native activation", function () {
	const target = { closest(selector) { return selector.includes("button") ? {} : null; } };
	assert.equal(api.command(key("3", { target })).label, "Satellite");
	assert.equal(api.command(key("w", { target })).kind, "sportMap");
	assert.equal(api.command(key(" ", { target })), undefined);
});

test("accepted shortcuts announce progress before native map selection completes", async function () {
	const f = fixture();
	f.controller.handle(key("3"));
	await f.controller.idle();
	assert.equal(f.notices[0], "Switching to Satellite…");
	assert.equal(f.notices.at(-1), "Satellite selected.");
});
