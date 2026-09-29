import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../content.js", import.meta.url), "utf8");
const dialogSource = source.slice(source.indexOf("function toggleSettingsDialog("), source.indexOf("function setupPanelControls("));

test("settings open beside the floater, clamp to mobile, close and reuse the same document", function () {
	let dialog;
	let reposition;
	const events = {};
	function element() {
		return {
			style: {}, attributes: {}, events: {}, hidden: false, contentWindow: {},
			setAttribute(key, value) { this.attributes[key] = value; },
			addEventListener(key, fn) { this.events[key] = fn; },
			append(...children) { this.children = children; },
			querySelector() { return this.children[0]; },
			focus() { this.focused = true; }
		};
	}
	const window = { innerWidth: 390, innerHeight: 700, addEventListener(key, fn) { events[key] = fn; } };
	const context = {
		window, URL,
		document: { querySelector() { return dialog; }, createElement: element, documentElement: { append(node) { dialog = node; } } },
		KrbBrowser: { runtime: { getURL() { return "https://extension.test/popup.html"; } } },
		MutationObserver: class { constructor(fn) { reposition = fn; } observe() {} }
	};
	runInNewContext(dialogSource, context);
	let rect = { right: 380, top: 80, bottom: 120 };
	const panel = { getBoundingClientRect() { return rect; } };
	const button = element();
	context.toggleSettingsDialog(panel, button);
	assert.equal(dialog.style.left, "20px");
	assert.equal(dialog.style.top, "126px");
	assert.equal(button.attributes["aria-expanded"], "true");
	const [close, frame] = dialog.children;
	close.events.click();
	assert.equal(dialog.hidden, true);
	assert.equal(button.focused, true);
	context.toggleSettingsDialog(panel, button);
	assert.equal(dialog.hidden, false);
	assert.equal(dialog.children[1], frame);
	events.message({ source: {}, origin: "https://extension.test", data: { type: "KRB_CLOSE_SETTINGS" } });
	assert.equal(dialog.hidden, false);
	events.message({ source: frame.contentWindow, origin: "https://other.test", data: { type: "KRB_CLOSE_SETTINGS" } });
	assert.equal(dialog.hidden, false);
	events.message({ source: frame.contentWindow, origin: "https://extension.test", data: { type: "KRB_CLOSE_SETTINGS" } });
	assert.equal(dialog.hidden, true);
	window.innerWidth = 320;
	window.innerHeight = 400;
	rect = { right: 310, top: 300, bottom: 330 };
	reposition();
	assert.equal(dialog.style.width, "304px");
	assert.equal(dialog.style.height, "auto");
	assert.equal(dialog.style.maxHeight, "280px");
	assert.equal(frame.style.height, "150px");
	assert.equal(dialog.style.left, "8px");
	assert.equal(dialog.style.top, "114px");
	events.message({ source: frame.contentWindow, origin: "https://extension.test", data: { type: "KRB_SETTINGS_SIZE", height: 600 } });
	assert.equal(frame.style.height, "250px");
	assert.equal(dialog.style.top, "14px");
	events.message({ source: frame.contentWindow, origin: "https://extension.test", data: { type: "KRB_SETTINGS_SIZE", height: 100 } });
	assert.equal(frame.style.height, "100px");
});
