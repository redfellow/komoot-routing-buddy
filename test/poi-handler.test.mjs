import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const source = readFileSync(new URL("../map-bridge.js", import.meta.url), "utf8"),
	handler = source.slice(source.indexOf("\tlet poiOperation;"), source.indexOf('\twindow.addEventListener("message", function (event) {', source.indexOf("\tlet poiOperation;")));

test("successful insertion explicitly invalidates old route keys with its own completion reason", async function () {
	const messages = [], context = {
		document: { body: { inert: false } }, location: { origin: "https://www.komoot.com", pathname: "/plan" },
		window: { postMessage: (message) => messages.push(message) }, checkedRouteKey: "current",
		routeSnapshot: () => ({ route: {}, routeKey: "current" }), rideCoordinates: () => ({}), clearRouteHighlight() {}, checkRouteChanged() {},
		KrbKomootPoiInsert: { async insert() { return { added: 1, skipped: 0, cancelled: false }; } },
	};
	runInNewContext(`${handler}\nthis.add = addApprovedPois;`, context);
	await context.add({ requestId: "poi:1", routeKey: "current", pois: [{}] });
	assert.equal(context.checkedRouteKey, undefined);
	assert.equal(messages[0].type, "KRB_POI_RESULT");
	assert.equal(messages[1].type, "KRB_ROUTE_CHANGED");
	assert.equal(messages[1].reason, "poi-insertion");
	assert.equal(context.document.body.inert, false);
});

test("page handler pauses native editing, restores it and replays completed requests without repeating mutation", async function () {
	const messages = [], body = { inert: false };
	let resolve, calls = 0, controls;
	const context = { document: { body }, location: { origin: "https://www.komoot.com", pathname: "/plan" },
		window: { postMessage: (message) => messages.push(message) }, checkedRouteKey: "current",
		routeSnapshot: () => ({ route: {}, routeKey: "current" }), rideCoordinates: () => ({}), checkRouteChanged() {},
		KrbKomootPoiInsert: { async insert(tour, pois, control) {
			calls++;
			controls = control;
			return await new Promise(function (finish) { resolve = finish; });
		} } };
	runInNewContext(`${handler}\nthis.add = addApprovedPois;`, context);
	const request = { requestId: "poi:1", routeKey: "current", pois: [{}] },
		operation = context.add(request);
	assert.equal(body.inert, true);
	assert.equal(controls.cancelled(), false);
	context.location.pathname = "/plan/other";
	assert.equal(controls.cancelled(), true);
	resolve({ added: 0, skipped: 0, cancelled: true });
	await operation;
	assert.equal(body.inert, false);
	await context.add(request);
	assert.equal(calls, 1);
	assert.equal(messages.length, 2);
	assert.equal(messages[1].cancelled, true);
});

test("failed insertion restores a pre-existing inert state and reports the error", async function () {
	const body = { inert: true }, messages = [], context = {
		document: { body }, location: { origin: "https://www.komoot.com", pathname: "/plan" },
		window: { postMessage: (message) => messages.push(message) }, checkedRouteKey: "current",
		routeSnapshot: () => ({ route: {}, routeKey: "current" }), rideCoordinates: () => ({}), checkRouteChanged() {},
		KrbKomootPoiInsert: { async insert() { throw new Error("Restored route after failure"); } },
	};
	runInNewContext(`${handler}\nthis.add = addApprovedPois;`, context);
	await context.add({ requestId: "poi:1", routeKey: "current", pois: [{}] });
	assert.equal(body.inert, true);
	assert.match(messages[0].error, /Restored/);
});
