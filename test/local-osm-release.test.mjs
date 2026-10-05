import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { validateSnapshot, validateFreshness } from "../scripts/local-osm/validate.mjs";
import { publishSelection, releaseSelection, policy } from "../scripts/local-osm/release-data.mjs";
const source = { url: "https://download.geofabrik.de/europe/finland-261004.osm.pbf", bytes: 1234, md5: "a".repeat(32), sha256: "b".repeat(64) };
const records = [{ type: "way", id: 1, tags: { highway: "path", "mtb:scale": "1" }, nodes: [10, 11], geometry: [{ lat: 61, lon: 24 }, { lat: 61.01, lon: 24.01 }] }, { type: "node", id: 10, tags: { barrier: "log" }, lat: 61, lon: 24 }];
const now = Date.parse("2026-10-05T12:00:00Z");
async function fixture(items = records) {
	const root = await mkdtemp(join(tmpdir(), "krb-release-data-")), directory = join(root, "local-osm-data", "finland-261004-aabbccdd"); await mkdir(directory, { recursive: true });
	const raw = Buffer.from(items.map((i) => JSON.stringify(i)).join("\n") + "\n"), bytes = gzipSync(raw);
	const manifest = { schemaVersion: 1, region: "finland", snapshotAt: "2026-10-04T20:00:00Z", source, license: "ODbL-1.0", attribution: "© OpenStreetMap contributors",
		coverage: { format: "osm-poly-rings-v1", rings: [{ hole: false, coordinates: [[23, 60], [25, 60], [25, 62], [23, 62], [23, 60]] }] },
		tags: "highway area mtb:scale width est_width surface obstacle overgrown barrier hazard hazard:forward hazard:backward layer bridge tunnel".split(" "), highways: ["path", "track", "footway", "bridleway", "cycleway"],
		counts: { way: items.filter((i) => i.type === "way").length, node: items.filter((i) => i.type === "node").length },
		shards: [{ file: "96_244.ndjson.gz", bytes: bytes.length, rawBytes: raw.length, records: items.length, sha256: createHash("sha256").update(bytes).digest("hex"), bounds: [23, 60, 25, 62] }] };
	await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest)); await writeFile(join(directory, manifest.shards[0].file), bytes);
	return { root, directory, manifest, async close() { await rm(root, { recursive: true, force: true }); } };
}
test("release gate validates records, membership, checksums and immutable release selection", async function () {
	const f = await fixture();
	try {
		const result = await validateSnapshot(f.directory, { now, maxAgeHours: 72, expectedSource: source });
		await publishSelection(f.root, result);
		assert.equal((await releaseSelection(f.root, { now, maxAgeHours: 72 })).manifest.counts.way, 1);
		await writeFile(join(f.directory, "manifest.json"), JSON.stringify({ ...f.manifest, snapshotAt: "2026-10-03T20:00:00Z" }));
		await assert.rejects(releaseSelection(f.root, { now, maxAgeHours: 72 }), /manifest changed/);
	}
	finally { await f.close(); }
});
test("stale or nonlatest source fails the gate while the previous selection stays intact", async function () {
	const f = await fixture();
	try {
		const result = await validateSnapshot(f.directory, { now, maxAgeHours: 72 }); await publishSelection(f.root, result);
		const before = await readFile(join(f.root, "local-osm-data/release.json"), "utf8");
		await assert.rejects(validateSnapshot(f.directory, { now: now + 4 * 86400000, maxAgeHours: 72 }), /stale/);
		await assert.rejects(validateSnapshot(f.directory, { now, maxAgeHours: 72, expectedSource: { ...source, md5: "c".repeat(32) } }), /not the latest/);
		assert.equal(await readFile(join(f.root, "local-osm-data/release.json"), "utf8"), before);
		assert.throws(() => validateFreshness(f.manifest, { now, maxAgeHours: NaN }), /policy/);
	}
	finally { await f.close(); }
});
test("corrupt files and mismatched hazard geometry or membership cannot pass", async function () {
	for (const node of [{ ...records[1], id: 99 }, { ...records[1], lat: 61.02 }]) {
		const f = await fixture([records[0], node]);
		try { await assert.rejects(validateSnapshot(f.directory), /parent way|coordinate differs/); }
		finally { await f.close(); }
	}
	const f = await fixture();
	try { await writeFile(join(f.directory, f.manifest.shards[0].file), "broken"); await assert.rejects(validateSnapshot(f.directory), /size mismatch/); }
	finally { await f.close(); }
});
test("release cannot proceed with an unconfirmed source-age policy", async function () {
	const f = await fixture();
	try { await mkdir(join(f.root, "scripts/local-osm"), { recursive: true }); await writeFile(join(f.root, "scripts/local-osm/release-policy.json"), '{"maxAgeHours":null}'); await assert.rejects(policy(f.root), /not been confirmed/); }
	finally { await f.close(); }
});

test("approved release freshness accepts seven days and rejects anything older", function () {
	const manifest = { snapshotAt: "2026-10-04T20:00:00Z" }, timestamp = Date.parse(manifest.snapshotAt);
	assert.doesNotThrow(() => validateFreshness(manifest, { now: timestamp + 7 * 86400000, maxAgeHours: 168 }));
	assert.throws(() => validateFreshness(manifest, { now: timestamp + 7 * 86400000 + 1, maxAgeHours: 168 }), /stale/);
});
