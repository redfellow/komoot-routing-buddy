import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function setup() {
	function element() {
		return {
			style: {},
			events: {},
			children: [],
			setAttribute() {},
			addEventListener(name, fn) {
				this.events[name] = fn;
			},
			append(...children) {
				this.children.push(...children);
			},
			replaceChildren(...children) {
				this.children = children;
			},
			querySelectorAll() {
				return this.children.map((row) => row.children[2]);
			},
		};
	}
	const nodes = Object.fromEntries(
		["#rules", "#status", "#restore"].map((name) => [name, element()]),
	);
	const timers = new Map();
	const writes = [];
	const previews = [];
	let frame;
	let timerId = 0;
	const context = {
		console,
		KrbSettings: { LEVELS: ["S0"] },
		KrbBrowser: {
			tabs: {
				async query() {
					return [{ id: 7 }];
				},
				async sendMessage(id, message) {
					previews.push(JSON.parse(JSON.stringify(message)));
				},
			},
			storage: {
				sync: {
					async set(value) {
						writes.push(JSON.parse(JSON.stringify(value)));
					},
				},
			},
		},
		document: {
			querySelector(name) {
				return nodes[name];
			},
			createElement: element,
		},
		window: {
			requestAnimationFrame(fn) {
				frame = fn;
				return 1;
			},
			setTimeout(fn) {
				timers.set(++timerId, fn);
				return timerId;
			},
			clearTimeout(id) {
				timers.delete(id);
			},
			addEventListener() {},
		},
	};
	const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8").replace(
		/initialise\(\);\s*$/,
		"",
	);
	runInNewContext(source, context);
	context.render({ S0: "highlight" }, { S0: "#26a269" });
	const row = nodes["#rules"].children[0];
	return {
		picker: row.children[2],
		editor: row.children[3],
		hex: row.children[3].children[3],
		slider: row.children[3].children[0].children[0],
		writes,
		timers,
		previews,
		preview() {
			return frame();
		},
	};
}

test("slider movement previews immediately before delayed persistence", async function () {
	const f = setup();
	f.picker.events.click();
	assert.equal(f.editor.hidden, false);
	f.slider.value = "255";
	f.slider.events.input();
	await f.preview();
	assert.deepEqual(f.previews, [{ type: "KRB_PREVIEW_COLOURS", colours: { S0: "#ffa269" } }]);
	assert.equal(f.writes.length, 0);
	await f.slider.events.change();
	assert.equal(f.timers.size, 0);
	assert.deepEqual(f.writes, [{ trailColours: { S0: "#ffa269" } }]);
});

test("hex edits coalesce, reject incomplete colours and save automatically", async function () {
	const f = setup();
	f.hex.value = "#ab";
	f.hex.events.input();
	assert.equal(f.timers.size, 0);
	f.hex.value = "#abcdef";
	f.hex.events.input();
	f.hex.value = "#123456";
	f.hex.events.input();
	assert.equal(f.timers.size, 1);
	await f.preview();
	assert.equal(f.previews[0].colours.S0, "#123456");
	await [...f.timers.values()][0]();
	assert.deepEqual(f.writes, [{ trailColours: { S0: "#123456" } }]);
	await f.hex.events.change();
	assert.equal(f.writes.length, 1);
	f.editor.children[4].events.click();
	assert.equal(f.editor.hidden, true);
});
