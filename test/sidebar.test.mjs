import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const source = fs.readFileSync(new URL("../sidebar.js", import.meta.url), "utf8");

async function setup(saved, initial = true) {
	let open = initial;
	let clicks = 0;
	let tick;
	let save;
	const writes = [];
	const events = {};
	const button = {
		click() {
			clicks++;
			open = !open;
		},
		contains(target) {
			return target === button;
		},
	};
	const path = {
		getAttribute() {
			return open
				? "M15.615 18.885L8.745 12l6.87-6.885L13.5 3l-9 9 9 9 2.115-2.115z"
				: "M5.385 5.115L12.255 12l-6.87 6.885L7.5 21l9-9-9-9-2.115 2.115z";
		},
		closest() {
			return button;
		},
	};
	vm.runInNewContext(source, {
		location: { pathname: "/tour/123/zoom" },
		console,
		document: {
			querySelectorAll(selector) {
				// Real sidebar buttons have no tooltip placement attribute until hovered.
				return selector === "button svg[viewBox=\"0 0 24 24\"] path" ? [path] : [];
			},
			addEventListener(name, fn) {
				events[name] = fn;
			},
		},
		window: {
			setInterval(fn) {
				tick = fn;
			},
			clearInterval() {
				tick = undefined;
			},
			setTimeout(fn) {
				save = fn;
			},
			clearTimeout() {},
		},
		KrbBrowser: {
			storage: {
				local: {
					async get() {
						return { sidebarOpen: saved };
					},
					async set(value) {
						writes.push(value.sidebarOpen);
					},
				},
			},
		},
	});
	await new Promise(setImmediate);
	return {
		tick() {
			tick?.();
		},
		save() {
			return save?.();
		},
		events,
		button,
		writes,
		setOpen(value) {
			open = value;
		},
		clicks() {
			return clicks;
		},
	};
}

test("restores closed sidebar once without overwriting saved state", async function () {
	const state = await setup(false);
	state.tick();
	state.tick();
	assert.equal(state.clicks(), 1);
	assert.deepEqual(state.writes, []);
});
test("restores open sidebar and leaves an already matching state alone", async function () {
	const closed = await setup(true, false);
	closed.tick();
	closed.tick();
	assert.equal(closed.clicks(), 1);
	const matching = await setup(true);
	matching.tick();
	assert.equal(matching.clicks(), 0);
});
test("records button changes after the UI updates", async function () {
	const state = await setup(true);
	state.tick();
	state.events.click({ isTrusted: true, target: state.button });
	state.setOpen(false);
	await state.save();
	assert.deepEqual(state.writes, [false]);
});
test("H overrides pending restoration, while typing H in an input is ignored", async function () {
	const state = await setup(false);
	state.events.keydown({
		isTrusted: true,
		key: "h",
		target: {
			closest() {
				return {};
			},
		},
	});
	await state.save();
	assert.deepEqual(state.writes, []);
	state.events.keydown({
		isTrusted: true,
		key: "h",
		target: {
			closest() {
				return null;
			},
		},
	});
	state.tick();
	await state.save();
	assert.equal(state.clicks(), 0);
	assert.deepEqual(state.writes, [true]);
});
test("initial visit remembers current state without toggling", async function () {
	const state = await setup(undefined);
	state.tick();
	await state.save();
	assert.equal(state.clicks(), 0);
	assert.deepEqual(state.writes, [true]);
});
