// @harvaaja-test-tier: fast
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function load(runtime) {
	const version = { textContent: "" };
	const nodes = { "#version": version };
	const stub = { addEventListener() {}, setAttribute() {}, style: {}, children: [] };
	const context = {
		console,
		KrbSettings: { LEVELS: [] },
		KrbBrowser: { runtime },
		document: {
			querySelector(name) {
				return nodes[name] ?? stub;
			},
			createElement() {
				return stub;
			},
		},
		window: { addEventListener() {}, setTimeout() {}, clearTimeout() {} },
	};
	context.window.parent = context.window;
	const source = readFileSync(new URL("../popup.js", import.meta.url), "utf8").replace(
		/initialise\(\);\s*$/,
		"",
	);
	runInNewContext(source, context);
	return version;
}

test("Version shown from manifest: popup shows the manifest version", function () {
	const version = load({
		getManifest() {
			return { version: "1.9.0" };
		},
	});
	assert.equal(version.textContent, "Version 1.9.0");
});

test("Version shown from manifest: line stays empty when the runtime API is unavailable", function () {
	assert.equal(load(undefined).textContent, "");
});
