import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function fixture() {
	const messages = [], listeners = [];
	let timeout;
	const window = { postMessage: (message) => messages.push(message), addEventListener: (_, listener) => listeners.push(listener) },
		context = { window, location: { origin: "https://www.komoot.com" },
			setTimeout: (callback) => { timeout = callback; return 1; }, clearTimeout() {} };
	for (const file of ["komoot-poi-data.js", "komoot-pois.js"])
		runInNewContext(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), context);
	return { api: context.KrbKomootPois, messages, timeout: () => timeout(),
		receive: function (data, origin = context.location.origin) {
			for (const listener of listeners) listener({ source: window, origin, data });
		} };
}
const poi = { id: "halfway", kind: "halfway", name: "Halfway", point: [23, 61], distance: 5000 };

test("approval transport requires a supported current route and allows only one pending insertion", async function () {
	const f = fixture();
	await assert.rejects(f.api.addApproved({ routeKey: "route", pois: [poi] }), /Analyse/);
	f.api.configure({ routeKey: "route", poiAvailable: true });
	await assert.rejects(f.api.addApproved({ routeKey: "older", pois: [poi] }), /Analyse/);
	const result = f.api.addApproved({ routeKey: "route", pois: [poi] });
	assert.equal(f.messages.length, 1);
	assert.equal(f.api.available(), false);
	await assert.rejects(f.api.addApproved({ routeKey: "route", pois: [poi] }), /processing/);
	const reply = { type: "KRB_POI_RESULT", requestId: f.messages[0].requestId, added: 1, skipped: 0 };
	f.receive(reply, "https://other.example");
	assert.equal(f.api.available(), false);
	f.receive({ ...reply, requestId: "unrelated" });
	assert.equal(f.api.available(), false);
	f.receive(reply);
	assert.equal((await result).added, 1);
	assert.equal(f.api.available(), true);
});

test("timed out insertion remains locked until Komoot confirms the result", async function () {
	const f = fixture();
	f.api.configure({ routeKey: "route", poiAvailable: true });
	const result = f.api.addApproved({ routeKey: "route", pois: [poi] });
	f.timeout();
	await assert.rejects(result, /not confirmed/);
	await assert.rejects(f.api.addApproved({ routeKey: "route", pois: [poi] }), /processing/);
	f.receive({ type: "KRB_POI_RESULT", requestId: f.messages[0].requestId, added: 1, skipped: 0 });
	assert.equal(f.api.available(), true);
});

test("route changes cancel pending work and invalidate insertion support", async function () {
	const f = fixture();
	f.api.configure({ routeKey: "route", poiAvailable: true });
	const result = f.api.addApproved({ routeKey: "route", pois: [poi] });
	f.receive({ type: "KRB_ROUTE_CHANGED" });
	assert.equal(f.messages[1].type, "KRB_POI_CANCEL");
	f.receive({ type: "KRB_POI_RESULT", requestId: f.messages[0].requestId, added: 0, skipped: 0, cancelled: true });
	assert.equal((await result).cancelled, true);
	assert.equal(f.api.available(), false);
});
