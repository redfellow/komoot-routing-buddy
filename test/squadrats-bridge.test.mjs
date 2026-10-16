import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const source = readFileSync(new URL("../map-bridge.js", import.meta.url), "utf8"),
	adapter = source.slice(source.indexOf("\tlet squadratsEstimateState"), source.indexOf("\tlet checkedRouteKey;"));
function fixture() {
	const messages = [], reads = [], context = { console,
		config: { estimateSquadrats: false, visualsEnabled: true },
		location: { origin: "https://www.komoot.com" }, window: { postMessage: (value) => messages.push(value) },
		squadrats: { enabled: true, config: {}, raw: { 14: new Set(), 17: new Set() } },
		polylib: {}, MAP: { POLYLINE: { encodePolyline() {} } }, rideCoordinates: () => [{ lng: 23, lat: 61 }],
		KrbSquadratsEstimate: { read(value) { reads.push(value); return { status: "ready", grids: [] }; } },
	};
	runInNewContext(`${adapter}\nthis.watch = watchSquadratsEstimate; this.read = readSquadratsEstimate;`, context);
	return { context, messages, reads };
}

test("disabled estimation never reads collection data, including while master Off", function () {
	const f = fixture();
	assert.equal(f.context.read({ route: {} }).status, "disabled");
	assert.equal(f.reads.length, 0);
	f.context.config.estimateSquadrats = true;
	assert.equal(f.context.read({ route: {} }).status, "ready");
	assert.equal(f.reads.length, 1);
	f.context.config.visualsEnabled = false;
	assert.equal(f.context.read({ route: {} }).status, "disabled");
	assert.equal(f.reads.length, 1);
});

test("collection replacement, size changes, account context and enabling invalidate estimates", function () {
	const f = fixture();
	f.context.watch();
	f.context.watch();
	assert.equal(f.messages.length, 1);
	f.context.config.estimateSquadrats = true;
	f.context.watch();
	assert.equal(f.messages.at(-1).enabled, true);
	f.context.squadrats.raw[17] = new Set(); // Same count, new generation.
	f.context.watch();
	assert.equal(f.messages.length, 3);
	f.context.squadrats.raw[17].add("1-1");
	f.context.watch();
	assert.equal(f.messages.length, 4);
	f.context.squadrats.config = {};
	f.context.watch();
	assert.equal(f.messages.length, 5);
});


test("disabled requests never inspect routes; active requests reject changed route keys", function () {
	const start = source.indexOf('\t\tif (event.data?.type === "KRB_SQUADRATS_REQUEST"'),
		end = source.indexOf('\t\tif (event.data?.type === "KRB_ROUTE_SNAPSHOT")', start),
		f = fixture();
	let snapshots = 0;
	f.context.routeSnapshot = function () { snapshots++; return { route: {}, routeKey: "current" }; };
	runInNewContext(`this.receive = function(event) { ${source.slice(start, end)} };`, f.context);
	f.context.receive({ data: { type: "KRB_SQUADRATS_REQUEST", requestId: "squadrats:1", routeKey: "current" } });
	assert.equal(snapshots, 0);
	assert.equal(f.messages.at(-1).data.status, "disabled");
	f.context.config.estimateSquadrats = true;
	f.context.receive({ data: { type: "KRB_SQUADRATS_REQUEST", requestId: "squadrats:2", routeKey: "stale" } });
	assert.equal(f.reads.length, 0);
	f.context.receive({ data: { type: "KRB_SQUADRATS_REQUEST", requestId: "squadrats:3", routeKey: "current" } });
	assert.equal(f.reads.length, 1);
	assert.equal(f.messages.at(-1).routeKey, "current");
	f.context.config.visualsEnabled = false;
	f.context.receive({ data: { type: "KRB_SQUADRATS_REQUEST", requestId: "squadrats:4", routeKey: "current" } });
	assert.equal(snapshots, 2);
	assert.equal(f.reads.length, 1);
});

test("estimator is wired into both script worlds and defaults on", async function () {
	const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")),
		content = readFileSync(new URL("../content.js", import.meta.url), "utf8"),
		settings = { KrbBrowser: { storage: { sync: { async get() { return {}; } } } } };
	runInNewContext(readFileSync(new URL("../settings.js", import.meta.url), "utf8"), settings);
	assert.equal((await settings.KrbSettings.getOptions()).estimateSquadrats, true);
	assert.ok(manifest.content_scripts[0].js.indexOf("squadrats-estimate.js") < manifest.content_scripts[0].js.indexOf("ride-dialog.js"));
	assert.ok(manifest.web_accessible_resources.some((entry) => entry.resources.includes("squadrats-estimate.js")));
	assert.ok(content.includes('getURL("squadrats-estimate.js")'));
	assert.ok(content.includes("estimateSquadrats: options.estimateSquadrats === true"));
	assert.deepEqual(manifest.permissions, ["storage", "unlimitedStorage", "declarativeNetRequestWithHostAccess", "alarms"]);
});


test("changing account context cannot reuse the previous account's tile sets", function () {
	const f = fixture();
	f.context.config.estimateSquadrats = true;
	assert.equal(f.context.read({ route: {} }).status, "ready");
	f.context.squadrats.config = {};
	assert.equal(f.context.read({ route: {} }).status, "unavailable");
	assert.equal(f.reads.length, 1);
	f.context.squadrats.raw[14] = new Set();
	assert.equal(f.context.read({ route: {} }).status, "unavailable");
	f.context.squadrats.raw[17] = new Set();
	assert.equal(f.context.read({ route: {} }).status, "ready");
	assert.equal(f.reads.length, 2);
});
