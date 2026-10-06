import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../content.js", import.meta.url), "utf8");
const controls = source.slice(
	source.indexOf("function setupPanelControls("),
	source.indexOf("function difficultySelector("),
);

function mount(state = {}) {
	function element() {
		return {
			listeners: {},
			addEventListener(name, fn) {
				this.listeners[name] = fn;
			},
			setPointerCapture() {},
		};
	}
	const header = element();
	const toggle = element();
	const settings = element();
	const saved = [];
	const panel = Object.assign(element(), {
		open: state.open !== false,
		style: {},
		offsetWidth: 280,
		offsetHeight: 100,
		querySelector(selector) {
			return selector === "summary" ? header : selector.includes("settings") ? settings : toggle;
		},
		getBoundingClientRect() {
			return { left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0 };
		},
	});
	const context = {
		console,
		window: { innerWidth: 1000, innerHeight: 700, addEventListener() {} },
		KrbBrowser: {
			storage: {
				local: {
					async set(value) {
						saved.push(structuredClone(value.panelState));
					},
				},
			},
		},
	};
	runInNewContext(controls, context);
	context.setupPanelControls(panel, state);
	return { panel, header, saved };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("restores panel position without overwriting saved state during initial toggle", async function () {
	const f = mount({ open: false, position: { left: 400, top: 200 } });
	assert.equal(f.panel.open, false);
	assert.equal(f.panel.style.left, "400px");
	assert.equal(f.panel.style.top, "200px");
	f.panel.listeners.toggle();
	await flush();
	assert.equal(f.saved.length, 0);
	f.panel.open = true;
	f.panel.listeners.toggle();
	await flush();
	assert.deepEqual(f.saved[0], { open: true, position: { left: 400, top: 200 } });
});

test("drag saves once and restores within a smaller viewport", async function () {
	const f = mount();
	const event = {
		button: 0,
		pointerId: 1,
		clientX: 0,
		clientY: 0,
		target: {
			closest() {
				return null;
			},
		},
	};
	f.header.listeners.pointerdown(event);
	f.header.listeners.pointermove({ ...event, clientX: 500, clientY: 250 });
	f.header.listeners.pointerup();
	f.header.listeners.lostpointercapture();
	await flush();
	assert.deepEqual(f.saved, [{ open: true, position: { left: 500, top: 250 } }]);
	assert.equal(mount(f.saved[0]).panel.style.left, "500px");
	const clamped = mount({ position: { left: 2000, top: 2000 } });
	assert.equal(clamped.panel.style.left, "720px");
	assert.equal(clamped.panel.style.top, "600px");
});

test("On/Off survives other option writes and falls back to the legacy preference", async function () {
	let saved = { trailOptions: { visualsEnabled: false } };
	const context = {
		KrbBrowser: {
			storage: {
				sync: {
					async get() {
						return saved;
					},
				},
			},
		},
	};
	runInNewContext(readFileSync(new URL("../settings.js", import.meta.url), "utf8"), context);
	assert.equal((await context.KrbSettings.getOptions()).visualsEnabled, false);
	saved = {
		trailVisualsEnabled: false,
		trailOptions: { visualsEnabled: true, maximumTrailLevel: "S2" },
	};
	assert.equal((await context.KrbSettings.getOptions()).visualsEnabled, false);
	saved.trailVisualsEnabled = true;
	assert.equal((await context.KrbSettings.getOptions()).visualsEnabled, true);
});
