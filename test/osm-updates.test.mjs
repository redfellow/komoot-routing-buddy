import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createHash, webcrypto } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
function fixture(fetcher) {
	const context = { indexedDB: new IDBFactory(), crypto: webcrypto, Uint8Array, Int32Array, DataView, Blob, TextDecoder, TextEncoder, Response, console, fetch: fetcher };
	for (const file of ["osm-md5.js", "osm-download.js"]) runInNewContext(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), context);
	return context;
}

test("incremental provider checksum matches standard MD5 vectors and arbitrary chunk boundaries", function () {
	const context = fixture();
	for (const text of ["", "a", "abc", "message digest", "x".repeat(100000)]) {
		const bytes = new TextEncoder().encode(text), md5 = context.KrbOsmMd5.create();
		for (let i = 0; i < bytes.length; i += 37) md5.update(bytes.subarray(i, i + 37));
		assert.equal(md5.digest(), createHash("md5").update(bytes).digest("hex"));
	}
});

test("download checkpoints resume from the committed byte offset and verify provider integrity", async function () {
	const bytes = new Uint8Array(9 * 1024 * 1024 + 17); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
	const calls = [], controller = new AbortController();
	const context = fixture(async function (url, options) {
		const range = options.headers?.Range, start = range ? Number(range.match(/\d+/)[0]) : 0; calls.push(start);
		return new Response(bytes.subarray(start), { status: start ? 206 : 200, headers: start ? { "Content-Range": `bytes ${start}-${bytes.length - 1}/${bytes.length}` } : {} });
	});
	const info = { url: "https://download.geofabrik.de/europe/finland-260930.osm.pbf", bytes: bytes.length, md5: createHash("md5").update(bytes).digest("hex") };
	let downloader = context.KrbOsmDownload.create();
	await assert.rejects(downloader.download(info, { signal: controller.signal, progress(p) { if (p.phase === "download") controller.abort(); } }), { name: "AbortError" });
	await downloader.close(); downloader = context.KrbOsmDownload.create();
	const source = await downloader.download(info);
	assert.deepEqual(calls, [0, 8 * 1024 * 1024]);
	assert.deepEqual(await source.read(8 * 1024 * 1024 - 10, 30), bytes.subarray(8 * 1024 * 1024 - 10, 8 * 1024 * 1024 + 20));
	await downloader.close();
});

test("bad transfers fail the checksum and restart instead of reusing errored data", async function () {
	const bytes = new Uint8Array([1, 2, 3]), context = fixture(async () => new Response(bytes));
	const downloader = context.KrbOsmDownload.create(), info = { url: "fixture", bytes: bytes.length, md5: "0".repeat(32) };
	await assert.rejects(downloader.download(info), /checksum mismatch/);
	const valid = await downloader.download({ ...info, md5: createHash("md5").update(bytes).digest("hex") });
	assert.deepEqual(await valid.read(0, 3), bytes);
	await downloader.close();
});

test("weekly scheduler respects opt-out, backoff and live jobs; due updates open one background tab", async function () {
	const now = Date.parse("2026-10-05T12:00:00Z"), saved = {}, tabs = [], handlers = {};
	const api = { runtime: { getURL: (p) => `chrome-extension://krb/${p}`, onInstalled: { addListener(fn) { handlers.install = fn; } }, onStartup: { addListener(fn) { handlers.start = fn; } } },
		alarms: { async get() { return {}; }, async create() {}, onAlarm: { addListener(fn) { handlers.alarm = fn; } } },
		storage: { local: { async get() { return saved; }, async set(value) { Object.assign(saved, value); } } }, tabs: { async create(tab) { tabs.push(tab); } } };
	const context = { KrbBrowser: api, KrbLocalOsm: { create() { return { async status() { return { snapshotAt: "2026-09-20T12:00:00Z" }; }, async close() {} }; } }, Date: { now: () => now, parse: Date.parse }, Math, console };
	runInNewContext(readFileSync(new URL("../osm-updates.js", import.meta.url), "utf8"), context);
	saved.localOsmAutoUpdate = false; await context.KrbOsmUpdates.check(); assert.equal(tabs.length, 0);
	saved.localOsmAutoUpdate = true; saved.localOsmUpdateState = { nextCheck: now + 1 }; await context.KrbOsmUpdates.check(); assert.equal(tabs.length, 0);
	saved.localOsmUpdateState = { running: true, heartbeat: now }; await context.KrbOsmUpdates.check(); assert.equal(tabs.length, 0);
	saved.localOsmUpdateState = {}; await context.KrbOsmUpdates.check(); assert.equal(tabs.length, 1); assert.equal(tabs[0].active, false);
	assert.match(tabs[0].url, /local-data.html\?automatic=1$/);
	await context.KrbOsmUpdates.check(); assert.equal(tabs.length, 1);
	saved.localOsmAutoUpdate = false; saved.localOsmUpdateState = { nextCheck: now + 7 * 86400000 };
	context.KrbBundledOsm = { create() { return { async manifest() { return { snapshotAt: "2026-10-04T12:00:00Z" }; } }; } };
	await context.KrbOsmUpdates.check(); assert.equal(tabs.length, 2); assert.match(tabs[1].url, /bundled=1$/);
});

test("provider polygon parser retains actual coverage and holes instead of trusting a bounding box", function () {
	const api = fixture().KrbOsmDownload;
	const c = api.polygon("Finland\n1\n20 60\n30 60\n30 70\n20 60\nEND\n!2\n24 64\n25 64\n25 65\n24 64\nEND\nEND");
	assert.equal(c.rings.length, 2); assert.equal(c.rings[1].hole, true);
	assert.throws(() => api.polygon("Finland\n1\n20 60\n30 60\nEND\nEND"), /coverage polygon/);
});

test("a previously verified download is rechecked after storage corruption on resume", async function () {
	const bytes = new Uint8Array([1, 2, 3]), context = fixture(async () => new Response(bytes));
	const info = { url: "fixture", bytes: 3, md5: createHash("md5").update(bytes).digest("hex") }, downloader = context.KrbOsmDownload.create();
	await downloader.download(info);
	const open = context.indexedDB.open("krb-osm-download-v1");
	const db = await new Promise((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
	const tx = db.transaction("chunks", "readwrite"); tx.objectStore("chunks").put(new Blob([new Uint8Array([0, 0, 0])]), 0);
	await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
	await assert.rejects(downloader.download(info), /checksum mismatch/);
	await downloader.close();
});
