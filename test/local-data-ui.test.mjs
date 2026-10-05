import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../local-data.js", import.meta.url), "utf8");
function setup(search = "") {
	const elements = new Map(), messages = [], confirmations = [];
	for (const id of ["snapshot", "status", "active", "cancel", "progress", "update", "automatic", "history"]) {
		elements.set(id, { files: [], addEventListener(type, callback) { this[type] = callback; } });
	}
	const saved = {};
	vm.runInNewContext(source, {
		URLSearchParams, location: { search }, console, setInterval() { return 1; }, clearInterval() {},
		document: { getElementById(id) { return elements.get(id); } },
		window: { confirm(text) { confirmations.push(text); return true; } },
		KrbBrowser: { storage: { local: { async get() { return saved; }, async set(value) { Object.assign(saved, value); } } } },
		KrbLocalOsm: { create() { return { async status() { return null; }, async close() {} }; } },
		Worker: class { postMessage(message) { messages.push(message); } terminate() {} }
	});
	return { elements, messages, confirmations };
}

test("paused bundled import resumes packaged data without a country download", async function () {
	const ui = setup("?bundled=1");
	await new Promise(setImmediate);
	assert.equal(ui.messages[0].type, "bundled");
	ui.elements.get("cancel").click();
	ui.elements.get("update").click();
	assert.equal(ui.messages[1].type, "bundled");
	assert.match(ui.confirmations[0], /included with this extension/);
});

test("paused folder import asks for the same folder instead of an update retry", async function () {
	const ui = setup();
	await new Promise(setImmediate);
	ui.elements.get("snapshot").files = [{ name: "manifest.json" }];
	ui.elements.get("snapshot").change();
	ui.elements.get("cancel").click();
	assert.equal(ui.elements.get("update").textContent, "Update Finland data");
	assert.match(ui.elements.get("status").textContent, /Select the same folder to resume/);
});
