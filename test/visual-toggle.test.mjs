import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../map-bridge.js", import.meta.url), "utf8");
const copy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function fixture() {
	const original = {
		id: "mtb-trails-easy", type: "line",
		filter: ["all", ["has", "mtb_scale"], ["!=", ["get", "bicycle"], "no"]],
		paint: { "line-color": "#123456", "line-opacity": { stops: [[16, 0.7], [17, 0]] } }
	};
	const layers = [copy(original), { id: "mtb-imba", type: "line", filter: ["has", "mtb_scale_imba"], paint: {} },
		{ id: "mtb-label", type: "symbol", layout: { "text-font": ["Satoshi Regular"] }, filter: ["has", "mtb_scale"], paint: {} }];
	const timers = [];
	const events = {};
	let interval;
	const receivers = [];
	const messages = [];
	const sources = new Map();
	const images = new Map();
	function receive(event) { for (const fn of receivers) fn(event); }
	let writes = 0;
	let rejectMissingLineGapWrites = false;
	const canvas = { getBoundingClientRect() { return { left: 100, top: 50 }; } };
	const map = {
		getCanvas() { return canvas; },
		hasImage(id) { return images.has(id); },
		addImage(id, data) { images.set(id, data); },
		getBounds() { return { getSouth: () => 61, getNorth: () => 61.01, getWest: () => 23, getEast: () => 23.01 }; },
		getZoom() { return 16; },
		getSource(id) { return sources.get(id); },
		addSource(id, source) { sources.set(id, source); },
		removeSource(id) { sources.delete(id); },
		addLayer(layer) { layers.push(copy(layer)); },
		removeLayer(id) { layers.splice(layers.findIndex((layer) => layer.id === id), 1); },
		getStyle() { return { layers }; },
		getLayer(id) { return layers.find((layer) => layer.id === id); },
		getLayoutProperty(id, key) { return this.getLayer(id).layout?.[key]; },
		setLayoutProperty(id, key, value) { const layer = this.getLayer(id); layer.layout ||= {}; if (value === null) delete layer.layout[key]; else layer.layout[key] = copy(value); },
		getFilter(id) { return this.getLayer(id).filter; },
		setFilter(id, value) { writes++; this.getLayer(id).filter = copy(value); },
		getPaintProperty(id, key) {
			const paint = this.getLayer(id).paint;
			if (["line-gap-width", "line-gap-color"].includes(key) && !(key in paint)) throw new TypeError("Uninitialized paint property");
			return paint[key];
		},
		setPaintProperty(id, key, value) {
			writes++;
			if (rejectMissingLineGapWrites && ["line-gap-width", "line-gap-color"].includes(key) && value !== null && !(key in this.getLayer(id).paint)) throw new TypeError("Unsupported paint property");
			if (value === null) delete this.getLayer(id).paint[key];
			else this.getLayer(id).paint[key] = copy(value);
		},
		on(name, fn) { events[name] = fn; },
		off(name) { delete events[name]; }
	};
	const fiber = { state: { map } };
	Object.defineProperty(fiber, "unsafe", { get() { throw new Error("Getter invoked"); } });
	canvas.parentElement = { __reactFiber$test: fiber };
	const window = { postMessage(message) { messages.push(copy(message)); }, addEventListener(type, fn) { receivers.push(fn); } };
	runInNewContext(source, {
		window, Image: class { set src(value) { this.onload(); } }, Node: class {}, console, location: { origin: "https://www.komoot.com" }, structuredClone,
		document: { currentScript: { dataset: { hazardIcons: "chrome-extension://test/hazard-icons.png" } }, createElement() { return { getContext() { return { drawImage() {}, getImageData(x, y, width, height) { return { width, height }; } }; } }; }, contains(value) { return value === canvas; }, querySelectorAll() { return [canvas]; } },
		clearTimeout() {},
		setInterval(fn) { interval = fn; },
		setTimeout(fn) { timers.push(fn); return timers.length; }
	});
	function flush() { while (timers.length) timers.shift()(); }
	function configure(overrides = {}, origin = "https://www.komoot.com") {
		receive({ source: window, origin, data: { type: "KRB_MAP_CONFIG", config: {
			visualsEnabled: true, maximumTrailLevel: "S5",
			rules: { S0: "highlight", S1: "avoid", S2: "off", S3: "highlight", S4: "highlight", S5: "highlight" }, ...overrides
		} } });
		flush();
	}
	interval(); flush();
	return { layers, original, configure, messages, sources, images, events, map, reply(data) { receive({ source: window, origin: "https://www.komoot.com", data }); flush(); }, writes: () => writes, rejectMissingLineGapWrites() { rejectMissingLineGapWrites = true; }, restyle() { events.idle(); flush(); } };
}

function luminance(hex) {
	const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
	const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
	return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function evaluate(expression, properties) {
	if (!Array.isArray(expression)) return expression;
	const [operator, ...args] = expression;
	const ev = (value) => evaluate(value, properties);
	switch (operator) {
		case "coalesce": return args.map(ev).find((value) => value !== undefined && value !== null);
		case "max": return Math.max(...args.map(ev));
		case "get": return properties[args[0]];
		case "has": return args[0] in properties;
		case "to-string": return String(ev(args[0]));
		case "match": {
			const input = ev(args[0]);
			for (let i = 1; i < args.length - 1; i += 2) {
				if (Array.isArray(args[i]) ? args[i].includes(input) : args[i] === input) return ev(args[i + 1]);
			}
			return ev(args.at(-1));
		}
		case "*": return ev(args[0]) * ev(args[1]);
		case "==": return ev(args[0]) === ev(args[1]);
		case "!=": return ev(args[0]) !== ev(args[1]);
		case "<=": return ev(args[0]) <= ev(args[1]);
		case "all": return args.every(ev);
		case "any": return args.some(ev);
		default: throw new Error(`Unsupported expression: ${operator}`);
	}
}

test("real mtb_scale values select highlight, warning and dimming without touching IMBA", function () {
	const f = fixture(); f.configure();
	const paint = f.layers[0].paint;
	for (const value of [0, "0", "0+", "0-", "S0"]) {
		assert.ok(luminance(evaluate(paint["line-color"], { mtb_scale: value })) < luminance("#26cd69"));
	}
	assert.equal(evaluate(paint["line-color"], { mtb_scale: "1+" }), "#7a1016");
	assert.equal(evaluate(paint["line-color"], { mtb_scale: "2" }), "#123456");
	const opacity = paint["line-opacity"];
	assert.deepEqual(opacity.slice(0, 4), ["interpolate", ["exponential", 1], ["zoom"], 16]);
	assert.ok(Math.abs(evaluate(opacity[4], { mtb_scale: "2" }) - 0.14) < 1e-10);
	assert.equal(evaluate(opacity[6], { mtb_scale: "0" }), 0);
	assert.deepEqual(f.layers[1].paint, {});
	assert.match(evaluate(f.layers[2].paint["text-color"], { mtb_scale: "0" }), /^#[0-9a-f]{6}$/);
});

test("maximum difficulty preserves native access restrictions and unknown values", function () {
	const f = fixture(); f.configure({ maximumTrailLevel: "S1" });
	const filter = f.layers[0].filter;
	assert.equal(evaluate(filter, { mtb_scale: "1-" }), true);
	assert.equal(evaluate(filter, { mtb_scale: "2" }), false);
	assert.equal(evaluate(filter, { mtb_scale: "0", bicycle: "no" }), false);
	assert.equal(evaluate(filter, { mtb_scale: "unknown" }), true);
});

test("Off restores original filters and paint including absent properties; repeated apply is stable", function () {
	const f = fixture(); f.configure();
	const applied = copy(f.layers);
	const writes = f.writes();
	f.configure(); f.restyle();
	assert.equal(f.writes(), writes);
	f.configure({ visualsEnabled: false });
	assert.deepEqual(f.layers[0], f.original);
	assert.deepEqual(f.layers[2].paint, {});
	f.configure();
	assert.deepEqual(f.layers, applied);
});

test("replacement style layers get new rules and restore their own original paint", function () {
	const f = fixture(); f.configure();
	const replacement = copy(f.original);
	replacement.paint["line-color"] = "#abcdef";
	f.layers[0] = copy(replacement); f.restyle();
	assert.ok(luminance(evaluate(f.layers[0].paint["line-color"], { mtb_scale: "0" })) < luminance("#abcdef"));
	f.configure({ visualsEnabled: false });
	assert.deepEqual(f.layers[0], replacement);
});

test("foreign-origin configuration is ignored", function () {
	const f = fixture(); f.configure({}, "https://example.com");
	assert.equal(f.writes(), 0);
});

test("visuals default to enabled and saved disabled preference survives option loading", async function () {
	let saved = {};
	const context = { KrbBrowser: { storage: { sync: { async get() { return saved; } } } } };
	runInNewContext(readFileSync(new URL("../settings.js", import.meta.url), "utf8"), context);
	assert.equal((await context.KrbSettings.getOptions()).visualsEnabled, true);
	saved = { trailOptions: { visualsEnabled: false, rememberLayers: true } };
	const options = await context.KrbSettings.getOptions();
	assert.equal(options.visualsEnabled, false);
	assert.equal(options.rememberLayers, true);
});

test("custom colours update live strokes and labels while avoid keeps its warning colour", function () {
	const f = fixture();
	f.configure({ colourLabels: true, colours: { S0: "#abcdef", S1: "#ffffff" } });
	assert.ok(luminance(evaluate(f.layers[0].paint["line-color"], { mtb_scale: "0" })) < luminance("#abcdef"));
	assert.equal(evaluate(f.layers[2].paint["text-color"], { mtb_scale: "0" }), "#abcdef");
	assert.equal(evaluate(f.layers[0].paint["line-color"], { mtb_scale: "1" }), "#7a1016");
	f.configure({ colourLabels: true, colours: { S0: "#123abc" } });
	assert.ok(luminance(evaluate(f.layers[0].paint["line-color"], { mtb_scale: "0" })) < luminance("#123abc"));
	f.configure({ colourLabels: true, colours: { S0: "invalid" } });
	assert.ok(luminance(evaluate(f.layers[0].paint["line-color"], { mtb_scale: "0" })) < luminance("#26cd69"));
	f.configure({ visualsEnabled: false });
	assert.deepEqual(f.layers[0], f.original);
});

test("saved colours merge with defaults and invalid values fall back safely", async function () {
	let saved = {};
	const context = { KrbBrowser: { storage: { sync: { async get() { return saved; } } } } };
	runInNewContext(readFileSync(new URL("../settings.js", import.meta.url), "utf8"), context);
	assert.deepEqual(copy(await context.KrbSettings.getColours()), copy(context.KrbSettings.HIGHLIGHT_COLOURS));
	saved = { trailColours: { S0: "#ABCDEF", S1: "red", S2: null } };
	const colours = await context.KrbSettings.getColours();
	assert.equal(colours.S0, "#ABCDEF");
	assert.equal(colours.S1, "#33b8ff");
	assert.equal(colours.S2, "#ffd400");
	assert.equal(colours.S5, "#000000");
});


test("default-map lines are dimmed with a darker outline while satellite keeps the vivid palette", function () {
	const f = fixture();
	f.configure();
	const colour = evaluate(f.layers[0].paint["line-color"], { mtb_scale: "0" });
	assert.ok(luminance(colour) < luminance("#26cd69"));
	f.layers.push({ id: "satellite", type: "raster", layout: { visibility: "visible" }, paint: { "raster-opacity": 1 } });
	f.configure();
	assert.equal(evaluate(f.layers[0].paint["line-color"], { mtb_scale: "0" }), "#26cd69");
});

test("rejected line-gap writes do not interrupt trail styling", function () {
	const f = fixture();
	f.layers.splice(0);
	f.layers.push({ id: "path", type: "line", filter: null, paint: { "line-width": 1 } });
	f.rejectMissingLineGapWrites();
	f.configure();
	assert.ok(Array.isArray(f.layers[0].paint["line-color"]));
	assert.ok(Array.isArray(f.layers[0].paint["line-width"]));
	assert.equal(f.layers[0].paint["line-gap-color"], undefined);
	assert.equal(f.layers[0].paint["line-gap-width"], undefined);
	const status = f.messages.filter((message) => message.type === "KRB_MAP_STATUS").at(-1);
	assert.equal(status.detail.enabled, true);
	assert.ok(status.detail.layers.includes("path"));
	const writes = f.writes();
	f.restyle();
	assert.equal(f.writes(), writes);
});

test("labels contrast with their halo while line colours remain unchanged; Off restores halo", function () {
	const f = fixture();
	const originalPaint = { "text-halo-color": "#eeeeee", "text-halo-width": 0.5, "text-halo-blur": 0.2 };
	Object.assign(f.layers[2].paint, originalPaint);
	for (const colour of ["#ffffff", "#ffff00", "#26cd69", "#7a1016", "#000000"]) {
		f.configure({ colourLabels: true, colours: { S0: colour } });
		const properties = { mtb_scale: "0" };
		const paint = f.layers[2].paint;
		const text = evaluate(paint["text-color"], properties);
		const rgb = [1, 3, 5].map(function (offset) {
			const c = parseInt(text.slice(offset, offset + 2), 16) / 255;
			return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
		});
		assert.ok((0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] + 0.05) / 0.05 >= 7);
		for (const offset of [1, 3, 5]) {
			assert.ok(parseInt(text.slice(offset, offset + 2), 16) >= parseInt(colour.slice(offset, offset + 2), 16));
		}
		if (colour === "#7a1016") {
			assert.notEqual(text, colour);
			assert.ok(parseInt(text.slice(1, 3), 16) > parseInt(text.slice(3, 5), 16));
		}
		assert.notEqual(evaluate(paint["text-color"], { mtb_scale: "1" }), "#7a1016");
		assert.equal(evaluate(paint["text-halo-color"], properties), "#000000");
		assert.equal(evaluate(paint["text-halo-width"], properties), 0.5);
		assert.ok(luminance(evaluate(f.layers[0].paint["line-color"], properties)) <= luminance(colour) || colour === "#000000");
		assert.equal(evaluate(paint["text-halo-width"], { mtb_scale: "2" }), 0.5);
		assert.equal(evaluate(paint["text-halo-width"], { mtb_scale: "unknown" }), 0.5);
	}
	f.configure({ visualsEnabled: false });
	assert.deepEqual(f.layers[2].paint, originalPaint);
});

test("Squadrats opacity scales fills and lines, preserves zoom stops and restores defaults", function () {
	const f = fixture();
	const fill = { id: "squadrats-squadrats", source: "squadrats-source", type: "fill", paint: { "fill-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.8, 14, 0.1] } };
	const line = { id: "squadrats-outline-squadrats", source: "squadrats-source", type: "line", paint: {} };
	const unrelated = { id: "squadrats-unrelated", source: "komoot", type: "fill", paint: { "fill-opacity": 0.7 } };
	f.layers.push(fill, line, unrelated);
	const original = copy(fill.paint);
	f.configure({ squadratsOpacity: 25, visualsEnabled: false });
	assert.deepEqual(fill.paint["fill-opacity"], ["interpolate", ["linear"], ["zoom"], 3, ["*", 0.8, 0.25], 14, ["*", 0.1, 0.25]]);
	assert.deepEqual(line.paint["line-opacity"], ["*", 1, 0.25]);
	assert.equal(unrelated.paint["fill-opacity"], 0.7);
	const writes = f.writes();
	f.restyle();
	assert.equal(f.writes(), writes);
	f.configure({ squadratsOpacity: 0 });
	assert.deepEqual(line.paint["line-opacity"], ["*", 1, 0]);
	f.configure({ squadratsOpacity: 100 });
	assert.deepEqual(fill.paint, original);
	assert.deepEqual(line.paint, {});
});

test("Squadrats layers arriving late, replaced or externally restyled get fresh baselines", function () {
	const f = fixture();
	f.configure({ squadratsOpacity: 50 });
	const layer = { id: "squadrats-grid", source: "squadrats-grid", type: "line", paint: { "line-opacity": 0.2 } };
	f.layers.push(layer); f.restyle();
	assert.deepEqual(layer.paint["line-opacity"], ["*", 0.2, 0.5]);
	layer.paint["line-opacity"] = 0.8;
	f.restyle();
	assert.deepEqual(layer.paint["line-opacity"], ["*", 0.8, 0.5]);
	layer.paint["line-opacity"] = 0.2;
	f.restyle();
	assert.deepEqual(layer.paint["line-opacity"], ["*", 0.2, 0.5]);
	f.layers.pop(); f.restyle();
	const replacement = { ...layer, paint: { "line-opacity": 0.4 } };
	f.layers.push(replacement); f.restyle();
	assert.deepEqual(replacement.paint["line-opacity"], ["*", 0.4, 0.5]);
	f.configure({ squadratsOpacity: 100 });
	assert.equal(replacement.paint["line-opacity"], 0.4);
});


test("Squadrats repaints after the map settles from a source update", function () {
	const f = fixture();
	f.configure({ squadratsOpacity: 50 });
	const layer = { id: "squadrats-grid", source: "squadrats-grid", type: "line", paint: { "line-opacity": 0.2 } };
	f.layers.push(layer);
	f.restyle();
	assert.deepEqual(layer.paint["line-opacity"], ["*", 0.2, 0.5]);
	layer.paint["line-opacity"] = 0.8;
	f.restyle();
	assert.deepEqual(layer.paint["line-opacity"], ["*", 0.8, 0.5]);
});


test("MTB visibility switches renderers and restores base path widths without accumulating changes", function () {
	const f = fixture();
	const path = { id: "path", type: "line", filter: null, paint: { "line-color": "#777777", "line-width": 1 } };
	const baseline = copy(path);
	f.layers.push(path);
	f.configure();
	assert.deepEqual(path, baseline);
	assert.equal(f.layers[0].paint["line-width"], undefined);
	for (let cycle = 0; cycle < 3; cycle++) {
		for (const layer of f.layers.slice(0, 3)) layer.layout = { visibility: "none" };
		f.restyle();
		assert.ok(luminance(evaluate(path.paint["line-color"], { mtb_scale: "0" })) < luminance("#26cd69"));
		assert.equal(evaluate(path.paint["line-width"], { mtb_scale: "0" }), 3);
		assert.equal(evaluate(path.paint["line-width"], {}), 1);
		assert.deepEqual(f.layers[0].paint, f.original.paint);
		for (const layer of f.layers.slice(0, 3)) layer.layout.visibility = "visible";
		f.restyle();
		assert.deepEqual(path, baseline);
		assert.equal(f.layers[0].paint["line-width"], undefined);
		assert.ok(luminance(evaluate(f.layers[0].paint["line-color"], { mtb_scale: "0" })) < luminance("#26cd69"));
	}
	f.configure({ visualsEnabled: false });
	assert.deepEqual(path, baseline);
	assert.deepEqual(f.layers[0].paint, f.original.paint);
});

test("base paths work without MTB layers and switch when the overlay is added or removed", function () {
	const f = fixture();
	const native = f.layers.splice(0);
	const path = { id: "track", type: "line", filter: null, paint: { "line-color": "#777777", "line-width": 2 } };
	const baseline = copy(path);
	f.layers.push(path);
	f.configure();
	assert.equal(evaluate(path.paint["line-color"], { mtb_scale: "1" }), "#7a1016");
	f.layers.push(...native); f.restyle();
	assert.deepEqual(path, baseline);
	f.layers.splice(1); f.restyle();
	assert.equal(evaluate(path.paint["line-width"], { mtb_scale: "0" }), 3);
	assert.equal(path.paint["line-gap-width"], 1);
	assert.equal(path.paint["line-gap-color"], "#000000");
	f.configure({ visualsEnabled: false });
	assert.deepEqual(path, baseline);
});


test("fallback preserves double-line widths while widening ordinary trails", function () {
	const f = fixture();
	f.layers.splice(0);
	const paints = [
		{ "line-gap-width": 3 },
		{ "line-offset": -2 },
		{ "line-gap-width": { stops: [[12, 0], [16, 4]] } },
		{ "line-gap-width": ["interpolate", ["linear"], ["zoom"], 12, 0, 16, 4] },
		{ "line-offset": ["case", ["has", "parallel"], 2, 0] }
	];
	for (const [index, paint] of paints.entries()) {
		f.layers.push({ id: `track-${index}`, type: "line", filter: null,
			paint: { "line-color": "#777777", "line-width": 1, ...paint } });
	}
	const baseline = copy(f.layers);
	const ordinary = { id: "path", type: "line", filter: null,
		paint: { "line-width": 1, "line-gap-width": 0, "line-offset": 0 } };
	f.layers.push(ordinary);
	f.configure();
	for (const [index, original] of baseline.entries()) {
		const layer = f.layers[index];
		assert.equal(layer.paint["line-width"], 1);
		assert.ok(luminance(evaluate(layer.paint["line-color"], { mtb_scale: "0" })) < luminance("#26cd69"));
		for (const key of ["line-gap-width", "line-offset"]) assert.deepEqual(layer.paint[key], original.paint[key]);
	}
	assert.equal(evaluate(ordinary.paint["line-width"], { mtb_scale: "0" }), 3);
	// A style update introducing a gap must also undo a previous width increase.
	ordinary.paint["line-gap-width"] = 2;
	f.restyle();
	assert.equal(ordinary.paint["line-width"], 1);
	const writes = f.writes();
	f.restyle();
	assert.equal(f.writes(), writes);
	f.configure({ visualsEnabled: false });
	assert.deepEqual(f.layers.slice(0, baseline.length), baseline);
});


test("ordinary trails widen when gap and offset expressions have only zero outputs", function () {
	const f = fixture();
	f.layers.splice(0);
	const zeroStyles = [
		0, { stops: [[12, 0], [18, 0]] },
		["interpolate", ["linear"], ["zoom"], 12, 0, 18, 0],
		["step", ["zoom"], 0, 12, 0, 18, 0],
		["case", ["has", "track"], 0, 0],
		["match", ["get", "class"], [1, 2], 0, 0], ["literal", 0]
	];
	for (const [index, value] of zeroStyles.entries()) {
		f.layers.push({ id: `path-${index}`, type: "line", paint: {
			"line-width": 1, "line-gap-width": value, "line-offset": value
		} });
	}
	f.configure();
	for (const layer of f.layers) {
		assert.equal(evaluate(layer.paint["line-width"], { mtb_scale: "0" }), 3);
		assert.equal(evaluate(layer.paint["line-width"], {}), 1);
	}
});


test("visible MTB labels do not suppress base trail colouring when MTB lines are hidden", function () {
	const f = fixture();
	f.layers[0].layout = { visibility: "none" };
	f.layers[1].layout = { visibility: "none" };
	const path = { id: "path", type: "line", filter: null, paint: { "line-width": 1, "line-color": "#777777" } };
	const baseline = copy(path);
	f.layers.push(path);
	f.configure();
	assert.ok(luminance(evaluate(path.paint["line-color"], { mtb_scale: "0" })) < luminance("#26cd69"));
	assert.equal(evaluate(path.paint["line-width"], { mtb_scale: "0" }), 3);
	assert.match(evaluate(f.layers[2].paint["text-color"], { mtb_scale: "0" }), /^#[0-9a-f]{6}$/);
	f.layers[0].layout.visibility = "visible";
	f.restyle();
	assert.deepEqual(path, baseline);
});


test("hazard overlays survive restyling, remain independent and ignore replies after disabling", function () {
	const f = fixture();
	f.configure({ showHazards: true, visualsEnabled: false });
	assert.equal(f.messages.some((message) => message.type === "KRB_HAZARD_VIEW"), false);
	assert.equal(f.sources.has("krb-conditions"), false);
	f.configure({ showHazards: true, visualsEnabled: true });
	const request = f.messages.find((message) => message.type === "KRB_HAZARD_VIEW");
	assert.ok(request);
	f.reply({ type: "KRB_HAZARD_DATA", requestId: request.requestId, data: { type: "FeatureCollection", features: [] } });
	assert.equal(f.sources.has("krb-conditions"), true);
	const original = copy(f.layers.filter((layer) => layer.id.startsWith("krb-conditions")));
	assert.equal(original.length, 12);
	f.restyle();
	assert.deepEqual(f.layers.filter((layer) => layer.id.startsWith("krb-conditions")), original);
	f.layers.splice(f.layers.findIndex((layer) => layer.id === "krb-conditions-line"), 1);
	f.restyle();
	assert.equal(f.layers.filter((layer) => layer.id.startsWith("krb-conditions")).length, 12);
	f.configure({ showHazards: false });
	assert.equal(f.sources.has("krb-conditions"), false);
	f.reply({ type: "KRB_HAZARD_DATA", requestId: request.requestId, data: { type: "FeatureCollection", features: [] } });
	assert.equal(f.sources.has("krb-conditions"), false);
});


test("hazard labels reuse the host font and defer safely when no supported font exists", function () {
	const f = fixture();
	const native = f.layers.find((layer) => layer.id === "mtb-label");
	delete native.layout["text-font"];
	f.configure({ showHazards: true });
	const request = f.messages.find((message) => message.type === "KRB_HAZARD_VIEW");
	f.reply({ type: "KRB_HAZARD_DATA", requestId: request.requestId, data: { type: "FeatureCollection", features: [] } });
	assert.ok(f.layers.find((layer) => layer.id === "krb-conditions-line"));
	assert.ok(f.layers.find((layer) => layer.id === "krb-conditions-icon-point-other"));
	assert.equal(f.layers.find((layer) => layer.id === "krb-conditions-label"), undefined);
	native.layout["text-font"] = ["Host Font Regular"];
	f.restyle();
	assert.deepEqual(f.layers.find((layer) => layer.id === "krb-conditions-label").layout["text-font"], ["Host Font Regular"]);
});


test("hazard hover prioritises markers, positions details and clears on leaving features", function () {
	const f = fixture();
	f.configure({ showHazards: true });
	const request = f.messages.find((message) => message.type === "KRB_HAZARD_VIEW");
	f.reply({ type: "KRB_HAZARD_DATA", requestId: request.requestId, data: { type: "FeatureCollection", features: [] } });
	f.map.queryRenderedFeatures = () => [
		{ layer: { id: "krb-conditions-line" }, properties: { label: "Width: 0.5 m" } },
		{ layer: { id: "krb-conditions-icon-point-other" }, properties: { label: "barrier: gate", tip_other: "barrier: gate" } }
	];
	f.events.mousemove({ point: { x: 20, y: 30 } });
	assert.deepEqual(f.messages.at(-1), { type: "KRB_HAZARD_TOOLTIP", text: "barrier: gate", x: 120, y: 80 });
	f.events.click({ point: { x: 20, y: 30 } });
	assert.equal(f.messages.at(-1).text, "barrier: gate");
	f.map.queryRenderedFeatures = () => [];
	f.events.mousemove({ point: { x: 25, y: 35 } });
	assert.equal(f.messages.at(-1).text, "");
	f.events.movestart();
	assert.equal(f.messages.at(-1).text, "");
	const label = f.layers.find((layer) => layer.id === "krb-conditions-label");
	assert.equal(label.layout["text-size"], 12);
	assert.deepEqual(label.layout["text-field"], ["get", "widthLabel"]);
});


test("each category has a separate image, layer and hit target", function () {
	const f = fixture();
	f.configure({ showHazards: true });
	const request = f.messages.find((message) => message.type === "KRB_HAZARD_VIEW");
	f.reply({ type: "KRB_HAZARD_DATA", requestId: request.requestId, data: { type: "FeatureCollection", features: [] } });
	assert.equal(f.images.size, 5);
	for (const key of ["mud", "vegetation", "narrow", "log", "other"]) {
		const layer = f.layers.find((item) => item.id === `krb-conditions-icon-point-${key}`);
		assert.equal(layer.layout["icon-image"], `krb-hazard-${key}`);
		f.map.queryRenderedFeatures = () => [{ layer, properties: { label: "all hazards", [`tip_${key}`]: key } }];
		f.events.mousemove({ point: { x: 5, y: 5 } });
		assert.equal(f.messages.at(-1).text, key);
	}
	f.images.clear();
	f.restyle();
	assert.equal(f.images.size, 5);
});


test("width labels switch contrast with satellite visibility without recreating the layer", function () {
	const f = fixture();
	f.configure({ showHazards: true });
	const request = f.messages.find((message) => message.type === "KRB_HAZARD_VIEW");
	f.reply({ type: "KRB_HAZARD_DATA", requestId: request.requestId, data: { type: "FeatureCollection", features: [] } });
	const label = f.layers.find((layer) => layer.id === "krb-conditions-label");
	assert.equal(label.layout["text-size"], 12);
	assert.equal(label.paint["text-color"], "#000000");
	assert.equal(label.paint["text-halo-color"], "#ffffff");
	const satellite = { id: "satellite", type: "raster", layout: {}, paint: {} };
	f.layers.push(satellite);
	f.restyle();
	assert.equal(label.paint["text-color"], "#ffffff");
	assert.equal(label.paint["text-halo-color"], "#000000");
	satellite.layout.visibility = "none";
	f.restyle();
	assert.equal(label.paint["text-color"], "#000000");
	assert.equal(label.paint["text-halo-color"], "#ffffff");
});


test("styling gives Squadrats its 100ms route-update window", function () {
	const scheduling = source.slice(source.indexOf("function scheduleApply()"), source.indexOf("window.addEventListener", source.indexOf("function scheduleApply()")));
	let now = 0;
	let routeTimer;
	let painted = false;
	const timers = [];
	const context = {
		applying: false, needsApply: false, scheduled: undefined, squadratsWait: undefined,
		setTimeout(fn, delay) { const timer = { fn, at: now + delay }; timers.push(timer); return timer; },
		apply() { context.scheduled = undefined; mapData(); }
	};
	runInNewContext(scheduling, context);
	function mapData() {
		if (routeTimer) routeTimer.cancelled = true;
		routeTimer = context.setTimeout(function () { painted = true; }, 100);
		context.scheduleApply();
	}
	mapData();
	while (timers.length && now < 300 && !painted) {
		timers.sort((a, b) => a.at - b.at);
		const timer = timers.shift();
		now = timer.at;
		if (!timer.cancelled) timer.fn();
	}
	assert.equal(painted, true, "styling must not continually postpone the route update");
	assert.equal(now, 100);
});


test("Squadrats source completion gates styling with a bounded fallback", function () {
	const start = source.indexOf("const squadratsRouteSources =");
	const code = source.slice(start, source.indexOf("window.addEventListener", start));
	let now = 0;
	let applied = 0;
	const timers = [];
	const context = {
		applying: false, needsApply: false, scheduled: undefined,
		map: { getStyle() { return { layers: [{ id: "squadrats-grid" }] }; }, getSource() { return {}; } },
		setTimeout(fn, delay) { const t = { fn, time: now + delay }; timers.push(t); return t; },
		clearTimeout(t) { if (t) t.cancelled = true; },
		apply() { applied++; }
	};
	runInNewContext(code, context);
	function advance(ms) {
		const end = now + ms;
		while (true) {
			timers.sort((a, b) => a.time - b.time);
			const t = timers.find((item) => !item.cancelled && item.time <= end);
			if (!t) break;
			t.cancelled = true; now = t.time; t.fn();
		}
		now = end;
	}
	const route = { sourceId: "komoot_tour", sourceDataType: "content" };
	context.scheduleApply();
	context.onSquadratsSource(route);
	context.scheduleApply();
	advance(600);
	assert.equal(applied, 0);
	context.onSquadratsSource({ sourceId: "squadrats-new-squadrats", sourceDataType: "content", isSourceLoaded: true });
	advance(600);
	assert.equal(applied, 0);
	context.onSquadratsSource({ sourceId: "squadrats-new-squadratinhos", sourceDataType: "content", isSourceLoaded: true });
	advance(500);
	assert.equal(applied, 1);
	context.onSquadratsSource(route);
	advance(2000);
	context.onSquadratsSource(route);
	advance(1500);
	assert.equal(applied, 2, "missing or unchanged sources must not block indefinitely");
	context.onSquadratsSource(route);
	context.clearSquadratsWait();
	advance(4000);
	assert.equal(applied, 2, "detaching the map cancels the fallback");
});

test("route preloading samples sparse segments, prioritises nearby cells and bounds work", function () {
	const code = source.slice(source.indexOf("function routeAreas("), source.indexOf("let routePreloadTimer;"));
	const context = {};
	runInNewContext(code, context);
	const geojson = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[23, 61], [24, 61]] } }] };
	const areas = context.routeAreas(geojson, [23.5, 61]);
	assert.equal(areas.length, 8);
	assert.ok(areas[0][1] < 23.5 && areas[0][3] > 23.5);
	assert.ok(areas.every((b) => b[0] < 61 && b[2] > 61 && b[3] - b[1] < 0.04));
	assert.equal(context.routeAreas(undefined, [23, 61]).length, 0);
	assert.equal(context.routeAreas({ type: "Feature", geometry: { type: "Point", coordinates: [23, 61] } }, [23, 61]).length, 0);
});


test("difficulty labels default to monochrome and follow the map type", function () {
	const f = fixture();
	f.configure();
	const label = f.layers.find((layer) => layer.id === "mtb-label");
	assert.equal(evaluate(label.paint["text-color"], { mtb_scale: "0" }), "#000000");
	assert.equal(evaluate(label.paint["text-halo-color"], { mtb_scale: "0" }), "#ffffff");
	const satellite = { id: "satellite", type: "raster", layout: {}, paint: {} };
	f.layers.push(satellite); f.restyle();
	assert.equal(evaluate(label.paint["text-color"], { mtb_scale: "0" }), "#ffffff");
	assert.equal(evaluate(label.paint["text-halo-color"], { mtb_scale: "0" }), "#000000");
	f.configure({ colourLabels: true });
	assert.notEqual(evaluate(label.paint["text-color"], { mtb_scale: "0" }), "#ffffff");
	f.configure({ colourLabels: false });
	satellite.layout.visibility = "none"; f.restyle();
	assert.equal(evaluate(label.paint["text-color"], { mtb_scale: "0" }), "#000000");
	f.configure({ visualsEnabled: false });
	assert.equal(label.paint["text-color"], undefined);
});


test("widths use the difficulty font and both label layers participate in collisions", function () {
	const f = fixture();
	const native = f.layers.find((layer) => layer.id === "mtb-label");
	native.layout["text-font"] = ["Satoshi Italic"];
	native.layout["text-allow-overlap"] = true;
	f.layers.unshift({ id: "place-label", type: "symbol", layout: { "text-font": ["Other Font"] }, paint: {} });
	f.configure({ showHazards: true });
	const request = f.messages.find((message) => message.type === "KRB_HAZARD_VIEW");
	f.reply({ type: "KRB_HAZARD_DATA", requestId: request.requestId, data: { type: "FeatureCollection", features: [] } });
	const width = f.layers.find((layer) => layer.id === "krb-conditions-label");
	assert.deepEqual(width.layout["text-font"], ["Satoshi Italic"]);
	for (const label of [width, native]) {
		assert.equal(label.layout["text-allow-overlap"], false);
		assert.equal(label.layout["text-ignore-placement"], false);
	}
	f.configure({ visualsEnabled: false });
	assert.equal(native.layout["text-allow-overlap"], true);
});

test("Squadrats sits above imagery and below roads without repeated layer moves", function () {
	const f = fixture();
	f.layers.splice(0, f.layers.length,
		{ id: "satellite", type: "raster", paint: {} },
		{ id: "road-casing", type: "line", paint: {} },
		{ id: "road-path", type: "line", paint: {} },
		{ id: "squadrats-fill", type: "fill", paint: {} },
		{ id: "squadrats-outline", type: "line", paint: {} });
	let moves = 0;
	f.map.moveLayer = function (id, before) {
		moves++;
		const [layer] = f.layers.splice(f.layers.findIndex((item) => item.id === id), 1);
		f.layers.splice(before === undefined ? f.layers.length : f.layers.findIndex((item) => item.id === before), 0, layer);
	};
	f.configure();
	assert.deepEqual(f.layers.map((layer) => layer.id), ["satellite", "squadrats-fill", "squadrats-outline", "road-casing", "road-path"]);
	f.restyle();
	assert.equal(moves, 2);
	f.configure({ squadratsBelowRoads: false });
	assert.deepEqual(f.layers.map((layer) => layer.id), ["satellite", "road-casing", "road-path", "squadrats-fill", "squadrats-outline"]);
	const afterRestore = moves;
	f.restyle();
	assert.equal(moves, afterRestore);
	f.configure({ squadratsBelowRoads: true });
	assert.deepEqual(f.layers.map((layer) => layer.id), ["satellite", "squadrats-fill", "squadrats-outline", "road-casing", "road-path"]);
	const [overlay] = f.layers.splice(1, 1);
	f.layers.push(overlay);
	f.restyle();
	assert.ok(f.layers.findIndex((layer) => layer.id === "squadrats-fill") < f.layers.findIndex((layer) => layer.id === "road-casing"));
	f.layers.splice(0, f.layers.length, { id: "osm", type: "raster", paint: {} }, overlay);
	const previous = moves;
	f.restyle();
	assert.equal(moves, previous, "do not bury overlays when roads are baked into raster tiles");
});

test("new Squadrats use double opacity scaling capped at the original opacity", function () {
	const f = fixture();
	const collected = { id: "squadrats-collected", source: "squadrats-source", type: "fill", paint: { "fill-opacity": 0.8 } };
	const fresh = ["squadrats-new-squadrats", "squadrats-new-squadratinhos"].map((id) => ({ id, source: id, type: "fill", paint: { "fill-opacity": 0.8 } }));
	f.layers.push(collected, ...fresh);
	f.configure();
	assert.deepEqual(collected.paint["fill-opacity"], ["*", 0.8, 0.5]);
	for (const layer of fresh) assert.equal(layer.paint["fill-opacity"], 0.8);
	f.configure({ squadratsOpacity: 25 });
	assert.deepEqual(collected.paint["fill-opacity"], ["*", 0.8, 0.25]);
	for (const layer of fresh) assert.deepEqual(layer.paint["fill-opacity"], ["*", 0.8, 0.5]);
	f.configure({ squadratsOpacity: 75 });
	for (const layer of fresh) assert.equal(layer.paint["fill-opacity"], 0.8);
	f.configure({ squadratsOpacity: 0 });
	for (const layer of fresh) assert.deepEqual(layer.paint["fill-opacity"], ["*", 0.8, 0]);
});

test("narrow threshold reuses cached measurements without mutating cached icons", function () {
	const code = source.slice(source.indexOf("function applyNarrowThreshold("), source.indexOf("let renderedHazardData;"));
	const context = {};
	runInNewContext(code, context);
	const data = { features: [0.2, 0.4, 0.5, 1].map((width) => ({ properties: { widthMetres: width, icon_vegetation: true, icon_narrow: false } })) };
	for (const threshold of [0.2, 0.4, 0.5, 1]) {
		const result = context.applyNarrowThreshold(data, threshold);
		for (const feature of result.features) assert.equal(feature.properties.icon_narrow, feature.properties.widthMetres <= threshold);
	}
	assert.ok(data.features.every((feature) => !feature.properties.icon_narrow));
});
