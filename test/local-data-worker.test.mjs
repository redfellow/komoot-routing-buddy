import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createHash, webcrypto } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
const bytes = new Uint8Array(readFileSync(new URL("fixtures/local-osm.osm.pbf", import.meta.url)));
const url = "https://download.geofabrik.de/europe/finland-260930.osm.pbf";
const coverage = {
	format: "osm-poly-rings-v1",
	rings: [
		{
			hole: false,
			coordinates: [
				[23, 60],
				[25, 60],
				[25, 62],
				[23, 62],
				[23, 60],
			],
		},
	],
};
async function fixture(broken = false) {
	const messages = [],
		calls = [],
		self = {
			postMessage(m) {
				messages.push(m);
			},
		};
	const context = {
		self,
		indexedDB: new IDBFactory(),
		crypto: webcrypto,
		Uint8Array,
		Int32Array,
		Float64Array,
		DataView,
		Blob,
		TextEncoder,
		TextDecoder,
		CompressionStream,
		DecompressionStream,
		Response,
		AbortSignal,
		structuredClone,
		console,
		performance,
		navigator: {
			locks: {
				async request(name, options, work) {
					assert.equal(name, "krb-osm-data-update");
					return work({});
				},
			},
		},
		importScripts() {},
		async fetch(path, options) {
			calls.push({ path, method: options?.method || "GET" });
			if (options?.method === "HEAD")
				return { ok: true, url, headers: new Headers({ "Content-Length": bytes.length }) };
			if (path.endsWith(".md5")) return new Response(createHash("md5").update(bytes).digest("hex"));
			if (path.endsWith(".poly"))
				return new Response("Finland\n1\n23 60\n25 60\n25 62\n23 62\n23 60\nEND\nEND");
			return new Response(broken ? new Uint8Array(bytes.length) : bytes);
		},
	};
	for (const file of [
		"local-osm.js",
		"bundled-osm.js",
		"osm-md5.js",
		"osm-download.js",
		"osm-pbf.js",
		"osm-prepare.js",
		"local-data-worker.js",
	])
		runInNewContext(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), context);
	const builder = context.KrbOsmPrepare.create({ name: "fixture-builder" }),
		store = context.KrbLocalOsm.create();
	const manifest = await builder.prepare(
		{
			size: bytes.length,
			async read(at, length) {
				return bytes.subarray(at, at + length);
			},
		},
		coverage,
		{ url: "older" },
	);
	manifest.snapshotAt = "2026-09-29T00:00:00Z";
	await store.importSnapshot(manifest, builder.loadShard);
	await builder.close();
	return { context, self, messages, calls, store };
}

test("update worker downloads, prepares, atomically activates and cleans temporary data; unchanged source skips transfer", async function () {
	const f = await fixture();
	await f.self.onmessage({ data: { type: "update" } });
	assert.equal(f.messages.at(-1).done, true);
	assert.equal((await f.store.status()).snapshotAt, "2026-09-30T20:22:42Z");
	assert.equal((await f.store.status()).source.url, url);
	const staging = f.context.KrbOsmPrepare.create();
	assert.equal(await staging.status(), undefined);
	await staging.close();
	await f.self.onmessage({ data: { type: "update" } });
	assert.equal(f.messages.at(-1).unchanged, true);
	assert.equal(f.calls.filter((c) => c.path === url && c.method === "GET").length, 1);
	await f.store.close();
});

test("failed source integrity leaves the previous snapshot available", async function () {
	const f = await fixture(true),
		before = (await f.store.status()).id;
	await f.self.onmessage({ data: { type: "update" } });
	assert.match(f.messages.at(-1).error, /checksum mismatch/);
	assert.equal((await f.store.status()).id, before);
	assert.equal((await f.store.query([[23, 60, 25, 62]])).elements.length, 5);
	await f.store.close();
});
