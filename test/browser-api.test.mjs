import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

for (const namespace of ["chrome", "browser"]) {
	test(`${namespace}: shared settings and background popup messaging`, async function () {
		let listener;
		let popupWindow;
		const api = {
			storage: {
				sync: {
					async get() {
						return { trailVisualsEnabled: false };
					},
				},
			},
			runtime: {
				id: "krb-test",
				onMessage: {
					addListener(fn) {
						listener ||= fn;
					},
				},
			},
			action: {
				async openPopup({ windowId }) {
					popupWindow = windowId;
				},
			},
		};
		const context = { [namespace]: api };
		runInNewContext(read("browser-api.js") + read("settings.js") + read("background.js"), context);
		assert.equal(context.KrbBrowser, api);
		assert.equal((await context.KrbSettings.getOptions()).visualsEnabled, false);
		const sender = { id: api.runtime.id, tab: { windowId: 7 } };
		let reply;
		assert.equal(
			listener({ type: "KRB_OPEN_SETTINGS" }, sender, function (value) {
				reply = value;
			}),
			true,
		);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(popupWindow, 7);
		assert.equal(reply.ok, true);
		assert.equal(
			listener({ type: "KRB_OPEN_SETTINGS" }, { id: "other", tab: {} }, function () {}),
			undefined,
		);
		api.action.openPopup = async function () {
			throw new Error("Popup unavailable");
		};
		listener({ type: "KRB_OPEN_SETTINGS" }, sender, function (value) {
			reply = value;
		});
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(reply.ok, false);
		assert.equal(reply.error, "Popup unavailable");
	});
}

test("Firefox namespace is preferred when both are available", function () {
	const context = { browser: {}, chrome: {} };
	runInNewContext(read("browser-api.js"), context);
	assert.equal(context.KrbBrowser, context.browser);
});

test("adapter loads before API consumers in each extension entry point", function () {
	const manifest = JSON.parse(read("manifest.json"));
	assert.equal(manifest.content_scripts[0].js[0], "browser-api.js");
	const popup = read("popup.html");
	assert.ok(popup.indexOf("src=\"browser-api.js\"") < popup.indexOf("src=\"settings.js\""));
	const loaded = [];
	runInNewContext(read(manifest.background.service_worker), {
		importScripts(...files) {
			loaded.push(...files);
		},
	});
	assert.deepEqual(loaded, [
		"browser-api.js",
		"osm-cache.js",
		"osm-overrides.js",
		"local-osm.js",
		"bundled-config.js",
		"bundled-osm.js",
		"osm-updates.js",
		"hazards.js",
		"background.js",
	]);
});

test("explicit route checks validate sender and work independently of hazard display", async function () {
	const listeners = [],
		calls = [];
	const context = {
		KrbBrowser: {
			runtime: {
				id: "krb",
				onMessage: {
					addListener(fn) {
						listeners.push(fn);
					},
				},
			},
		},
		KrbHazards: {
			async loadRoute(bounds, following) {
				calls.push({ bounds, following });
				return { type: "FeatureCollection", features: [] };
			},
		},
	};
	runInNewContext(read("background.js"), context);
	const listener = listeners.find((fn) => fn.toString().includes("\"KRB_CHECK_AREA\"")),
		message = {
			type: "KRB_CHECK_AREA",
			bounds: [61, 23, 61.001, 23.001],
			following: [[61, 23.001, 61.001, 23.002]],
		};
	assert.equal(
		listener(message, { id: "other", tab: {}, url: "https://www.komoot.com/plan" }, function () {}),
		undefined,
	);
	assert.equal(
		listener(message, { id: "krb", tab: {}, url: "https://example.com/plan" }, function () {}),
		undefined,
	);
	let response;
	assert.equal(
		listener(
			message,
			{ id: "krb", tab: {}, url: "https://www.komoot.com/tour/1/edit" },
			function (value) {
				response = value;
			},
		),
		true,
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(calls.length, 1);
	assert.equal(calls[0].following, message.following);
	assert.equal(response.data.type, "FeatureCollection");
});

test("whole-route local lookup is restricted to this extension's Komoot tabs", async function () {
	const listeners = [],
		calls = [];
	runInNewContext(read("background.js"), {
		KrbBrowser: {
			runtime: {
				id: "krb",
				onMessage: {
					addListener(fn) {
						listeners.push(fn);
					},
				},
			},
		},
		KrbHazards: {
			async loadLocalRoute(bounds) {
				calls.push(bounds);
				return undefined;
			},
		},
	});
	const listener = listeners.find((fn) => fn.toString().includes("\"KRB_CHECK_LOCAL_ROUTE\""));
	const message = { type: "KRB_CHECK_LOCAL_ROUTE", bounds: [[61, 24, 61.01, 24.01]] };
	assert.equal(
		listener(message, { id: "other", tab: {}, url: "https://www.komoot.com/plan" }, function () {}),
		undefined,
	);
	assert.equal(
		listener(message, { id: "krb", tab: {}, url: "https://example.com/" }, function () {}),
		undefined,
	);
	let response;
	assert.equal(
		listener(
			message,
			{ id: "krb", tab: {}, url: "https://www.komoot.com/tour/1/zoom" },
			function (value) {
				response = value;
			},
		),
		true,
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(calls.length, 1);
	assert.equal(response.data, null);
});
