import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
function fixture(load) {
	const fields = {}, messages = [], listeners = [], timers = new Map();
	let dialog, trigger, sequence = 0, now = 1000000;
	function element() {
		return { style: {}, attributes: {}, events: {}, children: [], hidden: false, offsetHeight: 400, value: "", checked: false,
			setAttribute(k, v) { this.attributes[k] = v; },
			addEventListener(k, fn) { this.events[k] = fn; },
			append(...nodes) { this.children.push(...nodes); },
			replaceChildren(...nodes) { this.children = nodes; },
			querySelector(selector) { return fields[selector.match(/"(.*?)"/)[1]]; },
			focus() {}, click() { return this.events.click?.({ preventDefault() {}, stopPropagation() {} }); },
			set innerHTML(value) {
				if (!value.includes("data-route=")) return;
				for (const match of value.matchAll(/data-route="([^"]+)"/g)) fields[match[1]] = element();
			}
		};
	}
	const window = { innerWidth: 600, innerHeight: 800, postMessage(message) { messages.push(message); }, addEventListener(name, fn) { if (name === "message") listeners.push(fn); } };
	const context = { window, console, AbortController, Date: { now: () => now }, location: { origin: "https://www.komoot.com" },
		document: { createElement: element, documentElement: { append(node) { dialog = node; } } },
		KrbBrowser: { storage: { sync: { async get() { return {}; }, async set() {} } }, runtime: { sendMessage(message) { return message.type === "KRB_CHECK_LOCAL_ROUTE" ? Promise.resolve({ data: null }) : load(message); } } },
		MutationObserver: class { observe() {} },
		setTimeout(fn, delay) { timers.set(++sequence, { fn, delay }); return sequence; }, clearTimeout(id) { timers.delete(id); }
	};
	for (const file of ["route-check.js", "route-dialog.js"]) runInNewContext(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), context);
	context.KrbRouteDialog.attach({ getBoundingClientRect() { return { right: 500, bottom: 80 }; }, querySelector() { return { before(node) { trigger = node; } }; } });
	return { fields, messages, tick(milliseconds) {
		now += milliseconds;
		for (const [id, timer] of [...timers]) if (timer.delay <= milliseconds) { timers.delete(id); timer.fn(); }
	}, get dialog() { return dialog; }, async open() { await trigger.click(); },
		receive(data) { for (const fn of listeners) fn({ source: window, origin: "https://www.komoot.com", data }); } };
}
const route = { type: "Feature", geometry: { type: "LineString", coordinates: [[23, 61], [23.002, 61]] }, properties: {} };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

test("dialog defaults, completed check, clickable results and route invalidation", async function () {
	const feature = { type: "Feature", geometry: route.geometry, properties: { osmId: "way/1", highway: "path", surface: "dirt", trailRating: "S2", widthMetres: 0.4 } };
	const f = fixture(async () => ({ data: { type: "FeatureCollection", features: [feature] } }));
	await f.open();
	assert.equal(f.fields.level.value, "S1");
	assert.equal(f.fields.width.value, "0.4");
	assert.equal(f.fields.hazards.checked, false);
	f.fields.start.click();
	const request = f.messages.findLast((m) => m.type === "KRB_ROUTE_SNAPSHOT");
	f.receive({ type: "KRB_ROUTE_SNAPSHOT_DATA", requestId: request.requestId, route, routeKey: "test-route" });
	await flush();
	assert.equal(f.fields.start.disabled, false);
	assert.match(f.fields.status.textContent, /1 trail warning/);
	f.fields.results.children[0].children[0].click();
	assert.equal(f.messages.at(-1).type, "KRB_ROUTE_FOCUS");
	f.receive({ type: "KRB_ROUTE_CHANGED" });
	assert.match(f.fields.status.textContent, /outdated/);
	assert.equal(f.fields.results.children.length, 0);
});

test("cancel ignores late data and retry shows incomplete errors", async function () {
	let finish;
	const f = fixture(() => new Promise((resolve) => { finish = resolve; }));
	await f.open(); f.fields.start.click();
	const request = f.messages.findLast((m) => m.type === "KRB_ROUTE_SNAPSHOT");
	f.receive({ type: "KRB_ROUTE_SNAPSHOT_DATA", requestId: request.requestId, route, routeKey: "test" });
	await flush(); f.fields.cancel.click();
	finish({ data: { type: "FeatureCollection", features: [] } });
	await flush();
	assert.match(f.fields.status.textContent, /cancelled/);
	assert.equal(f.fields.start.textContent, "Retry");
	f.fields.start.click();
	const retry = f.messages.findLast((m) => m.type === "KRB_ROUTE_SNAPSHOT");
	f.receive({ type: "KRB_ROUTE_SNAPSHOT_DATA", requestId: retry.requestId, route, routeKey: "test" });
	await flush(); finish({ error: "HTTP 429", retryMs: 30000, permanent: true }); await flush();
	assert.match(f.fields.status.textContent, /Trail check incomplete.*429.*30s/);
	assert.equal(f.fields.start.textContent, "Retry");
});

test("completed check uses requested wording and keeps unknown information visible", async function () {
	const f = fixture(async () => ({ data: { type: "FeatureCollection", features: [] } }));
	await f.open(); f.fields.start.click();
	const request = f.messages.findLast((m) => m.type === "KRB_ROUTE_SNAPSHOT");
	f.receive({ type: "KRB_ROUTE_SNAPSHOT_DATA", requestId: request.requestId, route, routeKey: "test" });
	await flush();
	assert.equal(f.fields.status.textContent, "No MTB-rated unpaved trails were identified on this route.");
	assert.equal(f.fields.progress.hidden, true);
	assert.equal(f.fields.unknown.textContent, "");
});

test("Retry keeps the dialog's completed-area checkpoint", async function () {
	const requested = [];
	const long = { ...route, geometry: { type: "LineString", coordinates: [[23, 61], [23.06, 61]] } };
	let fail = true;
	const f = fixture(async function (message) {
		requested.push(JSON.stringify(message.bounds));
		if (fail && requested.length === 2) return { error: "HTTP 504", permanent: true };
		return { data: { type: "FeatureCollection", features: [] } };
	});
	await f.open(); f.fields.start.click();
	let request = f.messages.findLast((m) => m.type === "KRB_ROUTE_SNAPSHOT");
	f.receive({ type: "KRB_ROUTE_SNAPSHOT_DATA", requestId: request.requestId, route: long, routeKey: "long" });
	await flush();
	assert.equal(f.fields.start.textContent, "Retry");
	assert.equal(requested.length, 2);
	fail = false; f.fields.start.click();
	request = f.messages.findLast((m) => m.type === "KRB_ROUTE_SNAPSHOT");
	f.receive({ type: "KRB_ROUTE_SNAPSHOT_DATA", requestId: request.requestId, route: long, routeKey: "long" });
	await flush();
	assert.equal(requested[2], requested[1]);
	assert.equal(requested.filter((value) => value === requested[0]).length, 1);
	assert.equal(f.fields.start.textContent, "Check trails");
});

test("temporary failures keep the dialog running with an automatic retry and Cancel", async function () {
	const f = fixture(async () => ({ error: "HTTP 429", retryMs: 60000 }));
	await f.open(); f.fields.start.click();
	const request = f.messages.findLast((m) => m.type === "KRB_ROUTE_SNAPSHOT");
	f.receive({ type: "KRB_ROUTE_SNAPSHOT_DATA", requestId: request.requestId, route, routeKey: "test" });
	await flush();
	assert.match(f.fields.activity.textContent, /retrying automatically in 60s/);
	f.tick(1000);
	assert.match(f.fields.activity.textContent, /retrying automatically in 59s/);
	assert.equal(f.fields.progress.hidden, false);
	assert.equal(f.fields.start.disabled, true);
	assert.equal(f.fields.cancel.hidden, false);
	f.fields.cancel.click(); await flush();
	assert.match(f.fields.status.textContent, /cancelled/);
	assert.equal(f.fields.start.disabled, false);
});

test("progress fills only for completed areas and stops on cancellation", async function () {
	let calls = 0, finish;
	const f = fixture(function () {
		if (++calls === 1) return Promise.resolve({ data: { type: "FeatureCollection", features: [], cacheSource: "memory" } });
		return new Promise(function (resolve) { finish = resolve; });
	});
	await f.open(); f.fields.start.click();
	const request = f.messages.findLast((m) => m.type === "KRB_ROUTE_SNAPSHOT");
	const long = { ...route, geometry: { type: "LineString", coordinates: [[23, 61], [23.06, 61]] } };
	f.receive({ type: "KRB_ROUTE_SNAPSHOT_DATA", requestId: request.requestId, route: long, routeKey: "long" });
	await flush();
	assert.equal(f.fields.progress.hidden, false);
	assert.match(f.fields.status.textContent, /Checking trails… \d+%/);
	assert.match(f.fields.counts.textContent, /^1\/\d+ areas · 1 cached · 0 downloaded$/);
	const percent = Number(f.fields.bar.attributes["aria-valuenow"]);
	assert.ok(percent > 0 && percent < 100);
	assert.equal(f.fields.fill.style.width, `${percent}%`);
	f.tick(1000);
	assert.equal(f.fields.fill.style.width, `${percent}%`);
	assert.equal(f.fields.cancel.hidden, false);
	f.fields.cancel.click();
	assert.equal(f.fields.progress.hidden, true);
	finish({ data: { type: "FeatureCollection", features: [] } });
	await flush();
	assert.match(f.fields.status.textContent, /cancelled/);
});
