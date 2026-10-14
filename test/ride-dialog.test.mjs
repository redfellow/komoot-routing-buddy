import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function fixture({ adapter = true, defer = false, deferInsert = false, stableGrades = false, existingPoi = false, poiCount, nativeAscent = false } = {}) {
	const fields = {}, messages = [], calls = [], geometryCalls = [], pauses = [], listeners = [];
	let trigger, resolveLoad, resolveInsert, checkData, checkState, checks = 0, mounts = 0, cancels = 0, loads = 0;
	function element() {
		return {
			children: [], events: {}, attributes: {}, dataset: {}, value: "", disabled: false,
			setAttribute(key, value) {
				this.attributes[key] = value;
				if (key === "data-already-present") this.dataset.alreadyPresent = value;
			},
			addEventListener(name, handler) { this.events[name] = handler; },
			append(...nodes) { this.children.push(...nodes); },
			replaceChildren(...nodes) { this.children = nodes; },
			querySelector(selector) { return fields[selector.match(/"(.*?)"/)[1]]; },
			focus() { this.focused = true; },
			click() { return this.events.click?.({ preventDefault() {}, stopPropagation() {} }); },
			set innerHTML(html) {
				for (const match of html.matchAll(/data-ride="([^"]+)"[^>]*>/g)) {
					const item = element();
					item.value = match[0].match(/value="([^"]+)"/)?.[1] || "";
					item.disabled = match[0].includes("disabled");
					item.hidden = match[0].includes("hidden");
					fields[match[1]] = item;
				}
			},
		};
	}
	const window = {
		postMessage(message) { messages.push(message); },
		addEventListener(name, handler) { if (name === "message") listeners.push(handler); },
	};
	const context = {
		window, AbortController, console,
		location: { origin: "https://www.komoot.com" },
		document: { createElement: element, createElementNS: element, documentElement: { append() {} } },
		setTimeout() { return 1; }, clearTimeout() {},
		KrbBrowser: { runtime: { async sendMessage() { throw new Error("Ride overview must not query OSM"); } } },
		KrbRouteDialog: {
			start() { checks++; },
			mount(host, callback, stateCallback) { mounts++; checkData = callback; checkState = stateCallback; },
			cancel() { cancels++; },
			setPaused(value) { pauses.push(value); },
		},
		KrbRouteCheck: {
			async collectWithRetry() {
				loads++;
				if (defer) return new Promise(function (resolve) { resolveLoad = resolve; });
				return [];
			},
		},
		KrbRideOverview: {
			markExisting: (pois) => pois.map((poi) => ({ ...poi, alreadyPresent: existingPoi && poi.kind === "trails" })),
			sectionCoordinates(points, start, end) { geometryCalls.push({ start, end }); return [[23, 61], [23.01, 61]]; },
			preferences: (value) => value,
			fromKomoot(data) {
				loads++;
				if (defer && loads === 1) return new Promise(function (resolve) { resolveLoad = resolve; });
				return stableGrades ? [{ character: "trail", mtbGrade: 0 }] : data;
			},
			analyse() {
				return { totalDistance: 10000, totals: { trail: 5000, track: 0, paved: 0, unknown: 5000 }, ascent: nativeAscent ? 650 : 0, ascentAvailable: nativeAscent, ascentSource: nativeAscent ? "Komoot" : "profile", elevationCoverage: 0,
					missingMtbDistance: 1000, missingMtbSections: [{ start: 6000, end: 6500 }, { start: 8000, end: 8500 }],
					sections: [{ kind: "trails", start: 0, end: 5000 }],
					pois: poiCount ? Array.from({ length: poiCount }, (_, index) => ({ id: `trail:${index}`, kind: "trails", name: "Trails", point: [23, 61], distance: index * 10 })) : [{ id: "trails:0", kind: "trails", point: [23, 61], name: "Trails", distance: 0, end: 5000 }, { id: "halfway", kind: "halfway", point: [23.01, 61], name: "Halfway", distance: 5000 }] };
			},
		},
	};
	if (adapter) context.KrbKomootPois = {
		available: () => true,
		async addApproved(value) {
			calls.push(value);
			if (deferInsert) return await new Promise(function (resolve) { resolveInsert = resolve; });
			return { added: value.pois.length };
		},
	};
	runInNewContext(readFileSync(new URL("../komoot-poi-data.js", import.meta.url), "utf8"), context);
	runInNewContext(readFileSync(new URL("../ride-dialog.js", import.meta.url), "utf8"), context);
	context.KrbRideDialog.attach({ querySelector() { return { append(node) { trigger = node; } }; } });
	trigger.click();
	function receive(data, origin = "https://www.komoot.com") {
		for (const handler of listeners) handler({ source: window, origin, data });
	}
	function snapshot() {
		fields.analyse.click();
		return { type: "KRB_ROUTE_SNAPSHOT_DATA", requestId: messages.at(-1).requestId, route: {}, nativeProfile: {}, routeKey: "original-route" };
	}
	return { fields, calls, messages, geometryCalls, pauses, receive, snapshot, checks: () => checks, mounts: () => mounts, cancels: () => cancels, checkData: (data) => checkData(data), checkState: (state) => checkState(state), resolve: () => resolveLoad([]), resolveInsert: () => resolveInsert({ added: 1, skipped: 0 }), loads: () => loads };
}
async function flush() {
	for (let index = 0; index < 15; index++) await Promise.resolve();
}

test("late insertion results cannot overwrite a route-change message", async function () {
	const f = fixture({ deferInsert: true });
	f.receive(f.snapshot());
	await flush();
	f.fields.generate.click();
	const insertion = f.fields.add.click();
	f.receive({ type: "KRB_ROUTE_CHANGED" });
	const message = f.fields.status.textContent;
	f.resolveInsert();
	await insertion;
	assert.equal(f.fields.status.textContent, message);
	assert.equal(f.fields.add.disabled, true);
});

test("suggestions require explicit generation and only checked points are sent after approval", async function () {
	const f = fixture();
	f.receive(f.snapshot());
	await flush();
	assert.equal(f.calls.length, 0);
	assert.equal(f.fields.candidates.children.length, 0);
	assert.equal(f.fields.generate.disabled, false);
	f.fields.generate.click();
	assert.equal(f.calls.length, 0);
	assert.equal(f.fields.candidates.children.length, 2);
	const checkbox = f.fields.candidates.children[0].children[0].children[0];
	checkbox.checked = false;
	checkbox.events.change();
	await f.fields.add.click();
	assert.equal(f.calls.length, 1);
	assert.equal(f.calls[0].routeKey, "original-route");
	assert.deepEqual(Array.from(f.calls[0].pois, (p) => p.name), ["Halfway"]);
	const completion = f.fields.status.textContent;
	f.receive({ type: "KRB_ROUTE_CHANGED", reason: "poi-insertion" });
	assert.equal(f.fields.status.textContent, completion);
	assert.equal(f.fields.generate.disabled, true);
});

test("foreign snapshots and duplicate replies do not start extra analysis", async function () {
	const f = fixture({ defer: true }), reply = f.snapshot();
	f.receive(reply, "https://other.example");
	assert.equal(f.loads(), 0);
	f.receive(reply);
	f.receive(reply);
	assert.equal(f.loads(), 1);
	f.resolve();
	await flush();
});

test("route edits invalidate approved selections and ignore late analysis", async function () {
	const f = fixture({ defer: true });
	f.receive(f.snapshot());
	f.receive({ type: "KRB_ROUTE_CHANGED" });
	f.resolve();
	await flush();
	assert.equal(f.fields.generate.disabled, true);
	assert.equal(f.fields.add.disabled, true);
	assert.equal(f.fields.candidates.children.length, 0);
	assert.equal(f.calls.length, 0);
});

test("unavailable insertion is explicit and threshold changes require fresh analysis", async function () {
	const f = fixture({ adapter: false });
	f.receive(f.snapshot());
	await flush();
	f.fields.generate.click();
	assert.equal(f.fields.add.disabled, true);
	assert.match(f.fields.status.textContent, /ready Komoot route editor/);
	f.fields.options.events.change();
	assert.equal(f.fields.generate.disabled, true);
	assert.equal(f.fields.candidates.children.length, 0);
});


test("invalid thresholds are explained before requesting a snapshot or querying OSM", function () {
	const f = fixture();
	f.fields["trail-gap"].value = "-1";
	f.fields.analyse.click();
	assert.equal(f.loads(), 0);
	assert.match(f.fields.status.textContent, /zero or more metres/);
	assert.equal(f.fields.generate.disabled, true);
});


test("preview stages expose one next action and keep the selected count accurate", async function () {
	const f = fixture();
	assert.equal(f.fields.generate.hidden, true);
	assert.equal(f.fields.add.hidden, true);
	f.receive(f.snapshot());
	await flush();
	assert.equal(f.fields.welcome.hidden, true);
	assert.equal(f.fields.results.hidden, false);
	assert.equal(f.fields.shape.open, true);
	assert.equal(f.fields.generate.hidden, false);
	f.fields.generate.click();
	assert.equal(f.fields.shape.open, false);
	assert.equal(f.fields.preview.hidden, false);
	assert.equal(f.fields.preview.open, true);
	assert.equal(f.fields["preview-title"].focused, true);
	const candidates = [...f.fields.candidates.children];
	f.fields.preview.open = false;
	f.fields.preview.open = true;
	assert.deepEqual(f.fields.candidates.children, candidates);
	assert.equal(f.fields.generate.hidden, true);
	assert.equal(f.fields.add.textContent, "Add 2 approved POIs");
	for (const item of f.fields.candidates.children) {
		const checkbox = item.children[0].children[0];
		checkbox.checked = false;
		checkbox.events.change();
	}
	assert.equal(f.fields["selection-count"].textContent, "0 selected");
	assert.equal(f.fields.add.disabled, true);
	f.fields.options.events.change();
	assert.equal(f.fields.results.hidden, true);
	assert.equal(f.fields.preview.hidden, true);
	assert.equal(f.fields.welcome.hidden, false);
});


test("shared panel mounts one checker and cancels it before POI insertion or closing", async function () {
	const f = fixture();
	assert.equal(f.mounts(), 1);
	f.receive(f.snapshot());
	await flush();
	f.fields.generate.click();
	await f.fields.add.click();
	assert.equal(f.cancels(), 1);
	f.fields.close.click();
	assert.equal(f.cancels(), 2);
});

test("matched OSM grade updates reset POI approval, while unrelated route results are ignored", async function () {
	const f = fixture();
	f.receive(f.snapshot());
	await flush();
	f.fields.generate.click();
	f.checkData({ routeKey: "other-route", features: [] });
	assert.equal(f.fields.candidates.children.length, 2);
	f.checkData({ routeKey: "original-route", features: [] });
	assert.equal(f.fields.candidates.children.length, 0);
	assert.equal(f.fields.add.disabled, true);
	assert.equal(f.fields.preview.hidden, true);
	assert.match(f.fields.status.textContent, /grades updated/);
	assert.equal(f.calls.length, 0);
	f.fields.generate.click();
	f.receive({ type: "KRB_OSM_DATA_UPDATED" });
	assert.equal(f.fields.add.disabled, true);
	assert.equal(f.fields.generate.disabled, true);
});


test("a check with unchanged MTB grades preserves the existing POI preview", async function () {
	const f = fixture({ stableGrades: true });
	f.receive(f.snapshot());
	await flush();
	f.fields.generate.click();
	const message = f.fields.status.textContent;
	f.checkData({ routeKey: "original-route", features: [] });
	assert.equal(f.fields.preview.hidden, false);
	assert.equal(f.fields.shape.open, false);
	assert.equal(f.fields.status.textContent, message);
	assert.equal(f.fields.candidates.children.length, 2);
});

test("checker grades arriving during native analysis are included before the overview is rendered", async function () {
	const f = fixture({ defer: true });
	f.receive(f.snapshot());
	f.checkData({ routeKey: "original-route", features: [] });
	f.resolve();
	await flush();
	assert.equal(f.loads(), 2);
	assert.equal(f.fields.generate.disabled, false);
});


test("POI magnifiers focus their section without selecting or inserting anything", async function () {
	const f = fixture();
	f.receive(f.snapshot());
	await flush();
	f.fields.generate.click();
	const item = f.fields.candidates.children[0], checkbox = item.children[0].children[0], focus = item.children[1];
	checkbox.checked = false;
	checkbox.events.change();
	focus.click();
	assert.equal(checkbox.checked, false);
	assert.equal(f.fields["selection-count"].textContent, "1 selected");
	assert.equal(f.calls.length, 0);
	assert.deepEqual(f.geometryCalls[0], { start: 0, end: 5000 });
	assert.equal(f.messages.at(-1).type, "KRB_ROUTE_FOCUS");
	assert.equal(f.messages.at(-1).routeKey, "original-route");
	assert.equal(f.messages.at(-1).fitSection, true);
	assert.equal(focus.attributes["aria-label"], "Zoom to Trails at 0.0 km");
	const halfway = f.fields.candidates.children[1].children[1];
	halfway.click();
	assert.deepEqual(f.geometryCalls[1], { start: 4900, end: 5100 });
	f.receive({ type: "KRB_ROUTE_CHANGED" });
	const count = f.geometryCalls.length;
	focus.click();
	assert.equal(f.geometryCalls.length, count);
});


test("insertion pauses the shared checker and POI preview controls until completion", async function () {
	const f = fixture({ deferInsert: true });
	f.receive(f.snapshot());
	await flush();
	f.fields.generate.click();
	const item = f.fields.candidates.children[0], checkbox = item.children[0].children[0], focus = item.children[1], operation = f.fields.add.click();
	assert.equal(checkbox.disabled, true);
	assert.equal(focus.disabled, true);
	assert.equal(f.fields.options.disabled, true);
	focus.click();
	assert.equal(f.geometryCalls.length, 0);
	f.checkData({ routeKey: "original-route", features: [] });
	assert.equal(f.fields.candidates.children.length, 2);
	f.resolveInsert();
	await operation;
	assert.deepEqual(f.pauses, [true, false]);
	assert.equal(checkbox.disabled, false);
	assert.equal(focus.disabled, false);
	assert.equal(f.fields.options.disabled, false);
});


test("Analyse route starts checks alongside the summary without waiting for native analysis", async function () {
	const f = fixture({ defer: true });
	f.receive(f.snapshot());
	await flush();
	assert.equal(f.checks(), 1);
	assert.equal(f.fields.generate.disabled, true);
	f.resolve();
	await flush();
	assert.equal(f.fields.generate.disabled, false);
});

test("closing before checker initialization prevents an automatic check", async function () {
	const f = fixture();
	f.fields.close.click();
	await flush();
	assert.equal(f.checks(), 0);
});

test("analysis section rows and interleaved warning rows both focus the map", async function () {
	const f = fixture();
	f.receive(f.snapshot());
	await flush();
	const section = f.fields.timeline.children[0].children[0];
	section.click();
	assert.deepEqual(f.geometryCalls[0], { start: 0, end: 5000 });
	assert.equal(f.messages.at(-1).fitSection, true);
	const warnings = [{ distance: 2500, text: "Muddy surface", point: [23.002, 61], coordinates: [[23, 61], [23.003, 61]] }];
	f.checkData({ routeKey: "original-route", features: [], warnings, distance: 10000 });
	assert.equal(f.fields.timeline.children.length, 2);
	const warning = f.fields.timeline.children[1].children[0];
	assert.match(warning.children[1].textContent, /2.5 km.*Muddy/);
	assert.equal(f.fields["event-count"].textContent, "1 warning");
	warning.click();
	assert.equal(f.messages.at(-1).type, "KRB_ROUTE_FOCUS");
	assert.equal(f.messages.at(-1).point, warnings[0].point);
	assert.equal(f.calls.length, 0);
	f.receive({ type: "KRB_ROUTE_CHANGED" });
	const count = f.geometryCalls.length;
	section.click();
	assert.equal(f.geometryCalls.length, count);
});


test("already-present proposed POIs remain zoomable but cannot be selected for insertion", async function () {
	const f = fixture({ existingPoi: true });
	f.receive(f.snapshot());
	await flush();
	f.fields.generate.click();
	const card = f.fields.candidates.children[0], checkbox = card.children[0].children[0], copy = card.children[0].children[2];
	assert.equal(checkbox.checked, false);
	assert.equal(checkbox.disabled, true);
	assert.match(copy.children[1].textContent, /Already on route/);
	assert.equal(f.fields.add.textContent, "Add 1 approved POI");
	card.children[1].click();
	assert.equal(f.calls.length, 0);
	assert.equal(f.messages.at(-1).type, "KRB_ROUTE_FOCUS");
});


test("over-limit selections require choosing fewer individual POIs", async function () {
	const f = fixture({ poiCount: 101 });
	f.receive(f.snapshot());
	await flush();
	f.fields.generate.click();
	assert.equal(f.fields.add.disabled, true);
	assert.match(f.fields.add.textContent, /at most 100/);
	assert.match(f.fields["selection-count"].textContent, /limit 100/);
	await f.fields.add.click();
	assert.equal(f.calls.length, 0);
	const checkbox = f.fields.candidates.children[0].children[0].children[0];
	checkbox.checked = false;
	checkbox.events.change();
	assert.equal(f.fields.add.disabled, false);
});

test("hover and keyboard previews highlight without a camera request and clear on leave", async function () {
	const f = fixture();
	f.receive(f.snapshot());
	await flush();
	const section = f.fields.timeline.children[0].children[0];
	section.events.pointerenter({ pointerType: "mouse" });
	assert.equal(f.messages.at(-1).previewOnly, true);
	assert.equal(f.messages.at(-1).fitSection, true);
	const id = f.messages.at(-1).previewId;
	section.events.pointerleave({});
	assert.equal(f.messages.at(-1).clearPreview, true);
	assert.equal(f.messages.at(-1).previewId, id);
	const count = f.messages.length;
	section.events.pointerenter({ pointerType: "touch" });
	assert.equal(f.messages.length, count);
	f.fields.generate.click();
	const card = f.fields.candidates.children[0];
	card.events.focusin({});
	assert.equal(f.messages.at(-1).previewOnly, true);
	card.children[1].click();
	assert.equal(f.messages.at(-1).previewOnly, undefined);
	assert.equal(f.messages.at(-1).fitSection, true);
	assert.equal(f.calls.length, 0);
});

test("independent progress and route-changed state preserve thresholds and reject stale actions", async function () {
	const f = fixture({ defer: true });
	const message = f.snapshot();
	f.receive(message);
	await flush();
	assert.equal(f.fields["ride-state"].textContent, "Reading route…");
	f.checkState({ phase: "checking", percent: 40 });
	assert.equal(f.fields["check-state"].textContent, "Checking 40%");
	f.resolve();
	await flush();
	assert.equal(f.fields["ride-state"].textContent, "Ready");
	assert.equal(f.fields["check-state"].textContent, "Checking 40%");
	f.fields.generate.click();
	f.fields["trail-length"].value = "700";
	const card = f.fields.candidates.children[0];
	f.receive({ type: "KRB_ROUTE_CHANGED" });
	assert.equal(f.fields.changed.hidden, false);
	assert.equal(f.fields.changed.textContent, "Route changed — reanalyse");
	assert.equal(f.fields["trail-length"].value, "700");
	card.children[1].click();
	card.events.pointerenter({ pointerType: "mouse" });
	await f.fields.add.click();
	assert.equal(f.calls.length, 0);
	assert.equal(f.fields.add.disabled, true);
});

test("individual selections stay paused during insertion and existing POIs stay disabled afterwards", async function () {
	const f = fixture({ deferInsert: true, existingPoi: true });
	f.receive(f.snapshot());
	await flush();
	f.fields.generate.click();
	const operation = f.fields.add.click();
	const checkbox = f.fields.candidates.children[1].children[0].children[0];
	assert.equal(checkbox.disabled, true);
	checkbox.events.change();
	assert.equal(f.fields["selection-count"].textContent, "1 selected");
	f.resolveInsert();
	await operation;
	assert.equal(checkbox.disabled, false);
	assert.equal(f.fields.candidates.children[0].children[0].children[0].disabled, true);
});


test("difficulty, width and obstacles use distinct symbols and readable warning labels", async function () {
	const f = fixture({ stableGrades: true });
	f.receive(f.snapshot());
	await flush();
	const warnings = [{ kind: "difficulty", text: "S2 exceeds S1" }, { kind: "width", text: "Narrow path" }, { kind: "hazard", text: "Fallen tree" }, { kind: "hazard", text: "Muddy surface" }].map((warning, index) => ({ ...warning, distance: 1000 + index * 100, point: [23, 61], coordinates: [[23, 61], [23.001, 61]] }));
	f.checkData({ routeKey: "original-route", features: [], warnings, distance: 10000 });
	const buttons = f.fields.timeline.children.slice(1).map((item) => item.children[0]);
	assert.deepEqual(buttons.map((button) => button.children[0].attributes["data-warning-symbol"]), ["difficulty", "width", "obstacle", "hazard"]);
	assert.match(buttons[0].attributes["aria-label"], /Difficulty/);
	assert.match(buttons[1].children[1].textContent, /Width/);
	assert.match(buttons[2].children[1].textContent, /Mapped hazard/);
	assert.ok(buttons.every((button) => button.children.at(-1).className === "krb-ride__section-icon"));
});


test("verified Komoot total ascent remains available when profile elevation is missing", async function () {
	const f = fixture({ nativeAscent: true });
	f.receive(f.snapshot());
	await flush();
	assert.equal(f.fields["ascent-total"].textContent, "650 m");
	assert.equal(f.fields["ascent-label"].textContent, "Ascent");
	assert.equal(f.fields.coverage.textContent, "Elevation missing · 100%");
});


test("proposed POIs retain individual choices without bulk selection controls", async function () {
	const f = fixture();
	f.receive(f.snapshot());
	await flush();
	f.fields.generate.click();
	for (const name of ["select-all", "clear-selection", "selection-controls", "select-types"])
		assert.equal(f.fields[name], undefined);
	const checkbox = f.fields.candidates.children[0].children[0].children[0];
	checkbox.checked = false;
	checkbox.events.change();
	assert.equal(f.fields["selection-count"].textContent, "1 selected");
	assert.equal(f.fields.add.textContent, "Add 1 approved POI");
});


test("missing-grades button highlights every gap without moving the camera and rejects stale data", async function () {
	const f = fixture();
	f.receive(f.snapshot());
	await flush();
	f.fields["highlight-grades"].click();
	assert.deepEqual(f.geometryCalls, [{ start: 6000, end: 6500 }, { start: 8000, end: 8500 }]);
	assert.equal(f.messages.at(-1).previewOnly, true);
	assert.equal(f.messages.at(-1).sections.length, 2);
	assert.equal(f.messages.at(-1).fitSection, undefined);
	assert.equal(f.calls.length, 0);
	f.receive({ type: "KRB_ROUTE_CHANGED" });
	const count = f.geometryCalls.length;
	f.fields["highlight-grades"].click();
	assert.equal(f.geometryCalls.length, count);
});
