import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../content.js", import.meta.url), "utf8");
const frameSource = source.slice(source.indexOf("function mountPanelSettings("), source.indexOf("function setupPanelControls("));

test("inline settings authenticate iframe messages, bound height and collapse without unloading", function () {
	const events = {}, sent = [];
	const frame = { style: {}, contentWindow: { postMessage(message, origin) { sent.push({ message, origin }); } }, addEventListener(name, fn) { this[name] = fn; } };
	const panel = { open: true, querySelector() { return frame; } };
	let guides = 0;
	const context = {
		URL, squadratsAvailable: true,
		window: { innerHeight: 800, addEventListener(name, fn) { events[name] = fn; } },
		KrbBrowser: { runtime: { getURL(file) { return `chrome-extension://test/${file}`; } } },
		KrbOnboarding: { show() { guides++; } },
	};
	runInNewContext(frameSource, context);
	context.mountPanelSettings(panel);
	frame.load();
	assert.equal(sent[0].message.squadratsAvailable, true);
	assert.equal(sent[0].origin, "chrome-extension://test");
	function receive(type, height, origin = "chrome-extension://test", sender = frame.contentWindow) {
		events.message({ source: sender, origin, data: { type, height } });
	}
	receive("KRB_SETTINGS_SIZE", 900, "https://evil.example");
	assert.equal(frame.style.height, undefined);
	receive("KRB_SETTINGS_SIZE", 900, "chrome-extension://test", {});
	assert.equal(frame.style.height, undefined);
	receive("KRB_SETTINGS_SIZE", 900);
	assert.equal(frame.style.height, "650px");
	receive("KRB_SETTINGS_SIZE", 200);
	assert.equal(frame.style.height, "212px");
	receive("KRB_CLOSE_SETTINGS");
	assert.equal(panel.open, false);
	assert.equal(frame.src, "chrome-extension://test/popup.html");
	panel.open = true;
	receive("KRB_SHOW_GUIDE");
	assert.equal(panel.open, false);
	assert.equal(guides, 1);
});

test("road numbers default on while an explicit saved off preference is retained", async function () {
	let saved = {};
	const context = { KrbBrowser: { storage: { sync: { async get() { return saved; } } } } };
	runInNewContext(readFileSync(new URL("../settings.js", import.meta.url), "utf8"), context);
	assert.equal((await context.KrbSettings.getOptions()).emphasizeRoadNumbers, true);
	saved = { trailOptions: { emphasizeRoadNumbers: false } };
	assert.equal((await context.KrbSettings.getOptions()).emphasizeRoadNumbers, false);
});


test("Squadrats controls start hidden and only accept context from their Komoot parent", function () {
	const popup = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
	const section = { hidden: true }, parent = {}, events = {};
	const context = {
		document: { querySelector() { return section; } },
		window: { parent, addEventListener(name, fn) { events[name] = fn; } },
	};
	runInNewContext(popup.slice(popup.indexOf("function showSquadratsSettings("), popup.indexOf("async function initialise(")), context);
	events.message({ source: {}, origin: "https://www.komoot.com", data: { type: "KRB_SETTINGS_CONTEXT", squadratsAvailable: true } });
	assert.equal(section.hidden, true);
	events.message({ source: parent, origin: "https://www.komoot.com", data: { type: "KRB_SETTINGS_CONTEXT", squadratsAvailable: true } });
	assert.equal(section.hidden, false);
	events.message({ source: parent, origin: "https://www.komoot.com", data: { type: "KRB_SETTINGS_CONTEXT", squadratsAvailable: false } });
	assert.equal(section.hidden, true);
});
