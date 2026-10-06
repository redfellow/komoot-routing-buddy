import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
const binary = new Uint8Array(readFileSync(new URL("fixtures/local-osm.osm.pbf", import.meta.url)));
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
function fixture() {
	const context = {
		indexedDB: new IDBFactory(),
		crypto: webcrypto,
		Uint8Array,
		Float64Array,
		DataView,
		Blob,
		CompressionStream,
		DecompressionStream,
		Response,
		TextEncoder,
		TextDecoder,
		structuredClone,
		console,
	};
	for (const file of ["osm-pbf.js", "osm-prepare.js", "local-osm.js"])
		runInNewContext(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), context);
	return context;
}
function source(bytes = binary) {
	return {
		size: bytes.length,
		async read(offset, length) {
			return bytes.subarray(offset, offset + length);
		},
	};
}

test("pyosmium-written fixture preserves coordinates, tags, membership and exclusion scope in browser preparation", async function () {
	const context = fixture(),
		builder = context.KrbOsmPrepare.create(),
		store = context.KrbLocalOsm.create();
	const manifest = await builder.prepare(source(), coverage, { url: "fixture" });
	assert.equal(manifest.snapshotAt, "2026-09-30T20:22:42Z");
	assert.deepEqual(JSON.parse(JSON.stringify(manifest.counts)), { way: 3, node: 2 });
	await store.importSnapshot(manifest, builder.loadShard);
	const records = new Map(
		(await store.query([[23, 60, 25, 62]])).elements.map((e) => [`${e.type}/${e.id}`, e]),
	);
	assert.deepEqual(Array.from(records.get("way/10").nodes), [1, 2, 3]);
	assert.equal(records.get("way/10").geometry[1].lon, 24.2);
	assert.equal(records.get("way/10").geometry[1].lat, 61);
	assert.equal(records.get("way/10").tags.name, undefined);
	assert.equal(records.get("node/2").tags.barrier, "log");
	assert.equal(records.get("node/4").tags.hazard, "slippery");
	assert.equal(records.has("node/5"), false);
	assert.equal(records.has("way/13"), false);
	assert.equal(records.has("way/14"), false);
	await store.close();
	await builder.close();
});

test("interrupted preparation resumes committed PBF blocks and publishes equivalent records without duplicates", async function () {
	const context = fixture(),
		builder = context.KrbOsmPrepare.create(),
		controller = new AbortController();
	let blocks = 0;
	await assert.rejects(
		builder.prepare(
			source(),
			coverage,
			{ url: "fixture", etag: "first" },
			{
				signal: controller.signal,
				progress() {
					if (++blocks === 2) controller.abort();
				},
			},
		),
		{ name: "AbortError" },
	);
	const offset = (await builder.status()).offset;
	assert.ok(offset > 0 && offset < binary.length);
	await builder.close();
	const next = context.KrbOsmPrepare.create(),
		reads = [];
	const manifest = await next.prepare(
		{
			size: binary.length,
			async read(at, length) {
				reads.push(at);
				return binary.subarray(at, at + length);
			},
		},
		coverage,
		{ url: "fixture", etag: "changed-but-same-content" },
	);
	assert.equal(reads[0], offset);
	assert.equal(manifest.counts.way, 3);
	assert.equal(manifest.counts.node, 2);
	const store = context.KrbLocalOsm.create();
	await store.importSnapshot(manifest, next.loadShard);
	assert.equal((await store.query([[23, 60, 25, 62]])).elements.length, 5);
	await store.close();
	await next.close();
});

test("truncated and oversized blocks fail without replacing the active snapshot", async function () {
	const context = fixture(),
		builder = context.KrbOsmPrepare.create(),
		store = context.KrbLocalOsm.create();
	const manifest = await builder.prepare(source(), coverage, { url: "fixture" });
	await store.importSnapshot(manifest, builder.loadShard);
	const original = (await store.status()).id;
	await assert.rejects(
		builder.prepare(source(binary.subarray(0, binary.length - 1)), coverage, { url: "broken" }),
		/length|Truncated/,
	);
	assert.equal((await store.status()).id, original);
	await assert.rejects(
		context.KrbOsmPbf.read(source(new Uint8Array([255, 255, 255, 255])), function () {}),
		/header length/,
	);
	await builder.close();
	await store.close();
});
