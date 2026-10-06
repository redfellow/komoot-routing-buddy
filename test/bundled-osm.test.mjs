import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { gzipSync } from "node:zlib";
import { webcrypto, createHash } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
function fixture() {
	const raw = Buffer.from(
			JSON.stringify({
				type: "way",
				id: 1,
				nodes: [10, 11],
				tags: { highway: "path", "mtb:scale": "1" },
				geometry: [
					{ lat: 61, lon: 24 },
					{ lat: 61.01, lon: 24.01 },
				],
			}) + "\n",
		),
		bytes = new Uint8Array(gzipSync(raw));
	const manifest = {
		schemaVersion: 1,
		region: "finland",
		snapshotAt: "2026-10-04T20:00:00Z",
		counts: { way: 1, node: 0 },
		coverage: {
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
		},
		shards: [
			{
				file: "96_244.ndjson.gz",
				bounds: [23, 60, 25, 62],
				bytes: bytes.length,
				rawBytes: raw.length,
				records: 1,
				sha256: createHash("sha256").update(bytes).digest("hex"),
			},
		],
	};
	const context = {
		crypto: webcrypto,
		indexedDB: new IDBFactory(),
		Uint8Array,
		Blob,
		Response,
		TextDecoder,
		TextEncoder,
		DecompressionStream,
		structuredClone,
	};
	for (const file of ["local-osm.js", "bundled-osm.js"])
		runInNewContext(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), context);
	return { context, bytes, manifest };
}
test("new install imports bundled compressed data without contacting an online provider", async function () {
	const f = fixture(),
		calls = [],
		bundle = f.context.KrbBundledOsm.create({
			base: "extension://data/finland/",
			async fetcher(path) {
				calls.push(path);
				return new Response(path.endsWith("manifest.json") ? JSON.stringify(f.manifest) : f.bytes);
			},
		}),
		store = f.context.KrbLocalOsm.create();
	await bundle.importInto(store);
	assert.equal((await store.query([[23, 60, 25, 62]])).elements.length, 1);
	assert.ok(calls.every((p) => p.startsWith("extension://data/finland/")));
	const count = calls.length;
	assert.equal((await bundle.importInto(store)).unchanged, true);
	assert.equal(calls.length, count + 1);
	await store.close();
});
test("interrupted/corrupt bundled install retains prior snapshot and missing bundle is a source-checkout condition", async function () {
	const f = fixture(),
		store = f.context.KrbLocalOsm.create();
	await store.importSnapshot(f.manifest, async () => f.bytes);
	const before = (await store.status()).id;
	const next = { ...f.manifest, snapshotAt: "2026-10-05T20:00:00Z" },
		broken = f.context.KrbBundledOsm.create({
			async fetcher(path) {
				return new Response(
					path.endsWith("manifest.json") ? JSON.stringify(next) : new Uint8Array(f.bytes.length),
				);
			},
		});
	await assert.rejects(broken.importInto(store), /checksum mismatch/);
	assert.equal((await store.status()).id, before);
	const missing = f.context.KrbBundledOsm.create({
		enabled: false,
		async fetcher() {
			throw new Error("Source checkout must not request missing bundle files");
		},
	});
	assert.equal(await missing.manifest(), undefined);
	await store.close();
});

test("interrupted first installation resumes validated bundled shards without downloading them again", async function () {
	const f = fixture(),
		item = {
			type: "way",
			id: 2,
			nodes: [12, 13],
			tags: { highway: "path" },
			geometry: [
				{ lat: 61.02, lon: 24.02 },
				{ lat: 61.03, lon: 24.03 },
			],
		};
	const raw = Buffer.from(JSON.stringify(item) + "\n"),
		second = new Uint8Array(gzipSync(raw));
	f.manifest.counts.way = 2;
	f.manifest.shards.push({
		...f.manifest.shards[0],
		file: "97_244.ndjson.gz",
		bytes: second.length,
		rawBytes: raw.length,
		sha256: createHash("sha256").update(second).digest("hex"),
	});
	let fail = true,
		firstReads = 0;
	const bundle = f.context.KrbBundledOsm.create({
			async fetcher(path) {
				if (path.endsWith("manifest.json")) return new Response(JSON.stringify(f.manifest));
				if (path.endsWith("96_244.ndjson.gz")) {
					firstReads++;
					return new Response(f.bytes);
				}
				return new Response(fail ? "offline" : second, { status: fail ? 503 : 200 });
			},
		}),
		store = f.context.KrbLocalOsm.create();
	await assert.rejects(bundle.importInto(store), /503/);
	assert.equal(await store.status(), null);
	fail = false;
	await bundle.importInto(store);
	assert.equal(firstReads, 1);
	assert.equal((await store.query([[23, 60, 25, 62]])).elements.length, 2);
	await store.close();
});
