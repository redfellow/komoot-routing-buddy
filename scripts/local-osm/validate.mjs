import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { createGunzip } from "node:zlib";
import { runInNewContext } from "node:vm";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const context = {};
runInNewContext(await readFile(new URL("../../local-osm.js", import.meta.url), "utf8"), context);
const { validateManifest, recordBounds } = context.KrbLocalOsm;
const tags = "highway area mtb:scale width est_width surface obstacle overgrown barrier hazard hazard:forward hazard:backward layer bridge tunnel".split(" ");
const highways = ["bridleway", "cycleway", "footway", "path", "track"];
export class SnapshotValidationError extends Error {
	constructor(message) { super(message); this.name = "SnapshotValidationError"; }
}
export function validateFreshness(manifest, { now = Date.now(), maxAgeHours, expectedSource } = {}) {
	if (maxAgeHours !== undefined && (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0)) throw new SnapshotValidationError("Invalid release freshness policy");
	const time = Date.parse(manifest.snapshotAt);
	if (!Number.isFinite(time) || time > now + 300000 || maxAgeHours !== undefined && now - time > maxAgeHours * 3600000) throw new SnapshotValidationError("Finland source snapshot is stale or has an invalid future date");
	if (expectedSource && (manifest.source?.url !== expectedSource.url || manifest.source.md5 !== expectedSource.md5 || manifest.source.bytes !== expectedSource.bytes || expectedSource.coverage && JSON.stringify(manifest.coverage) !== JSON.stringify(expectedSource.coverage))) throw new SnapshotValidationError("Prepared data is not the latest required Finland extract/coverage");
}
async function scan(directory, entry, visit) {
	const input = createReadStream(join(directory, entry.file)), unzip = createGunzip(), hash = createHash("sha256"), decoder = new TextDecoder("utf-8", { fatal: true });
	let compressed = 0, raw = 0, pending = "", count = 0;
	input.on("data", function (bytes) { compressed += bytes.length; hash.update(bytes); });
	input.on("error", (error) => unzip.destroy(error)); input.pipe(unzip);
	try {
		for await (const bytes of unzip) {
			raw += bytes.length;
			if (raw > entry.rawBytes) throw new SnapshotValidationError("Decompressed data exceeds declared size");
			pending += decoder.decode(bytes, { stream: true });
			let end;
			while ((end = pending.indexOf("\n")) !== -1) {
				const line = pending.slice(0, end); pending = pending.slice(end + 1);
				if (line.length > 4 * 1024 * 1024) throw new SnapshotValidationError("OSM record exceeds supported size");
				visit(JSON.parse(line)); count++;
			}
			if (pending.length > 4 * 1024 * 1024) throw new SnapshotValidationError("OSM record exceeds supported size");
		}
		pending += decoder.decode();
		if (pending || raw !== entry.rawBytes || compressed !== entry.bytes || count !== entry.records || hash.digest("hex") !== entry.sha256) throw new SnapshotValidationError(`Invalid snapshot file: ${entry.file}`);
	}
	finally { input.destroy(); unzip.destroy(); }
}
export async function validateSnapshot(directory, options = {}) {
	directory = resolve(directory);
	const path = join(directory, "manifest.json");
	if ((await stat(path)).size > 8 * 1024 * 1024) throw new SnapshotValidationError("Oversized snapshot manifest");
	const manifest = JSON.parse(await readFile(path, "utf8")); validateManifest(manifest); validateFreshness(manifest, options);
	if (!/^https:\/\/download\.geofabrik\.de\/europe\/finland-\d{6}\.osm\.pbf$/.test(manifest.source?.url || "") || !/^[a-f0-9]{32}$/.test(manifest.source.md5 || "") || !/^[a-f0-9]{64}$/.test(manifest.source.sha256 || "") || !Number.isSafeInteger(manifest.source.bytes) || manifest.source.bytes <= 0 || !Array.isArray(manifest.tags) || !Array.isArray(manifest.highways) || manifest.license !== "ODbL-1.0" || !manifest.attribution?.includes("OpenStreetMap") || JSON.stringify([...manifest.tags].sort()) !== JSON.stringify([...tags].sort()) || JSON.stringify([...manifest.highways].sort()) !== JSON.stringify(highways)) throw new SnapshotValidationError("Missing or invalid data provenance/license/extraction scope");
	const seen = new Set(), nodes = new Map(), members = new Set(), counts = { way: 0, node: 0 };
	for (const entry of manifest.shards) {
		if ((await stat(join(directory, entry.file))).size !== entry.bytes) throw new SnapshotValidationError(`Snapshot file size mismatch: ${entry.file}`);
		await scan(directory, entry, function (item) {
			const bounds = recordBounds(item), key = `${item.type}/${item.id}`;
			if (seen.has(key)) throw new SnapshotValidationError("Duplicate OSM feature"); seen.add(key);
			if (bounds[0] < entry.bounds[0] || bounds[1] < entry.bounds[1] || bounds[2] > entry.bounds[2] || bounds[3] > entry.bounds[3]) throw new SnapshotValidationError("Geometry outside spatial directory");
			if (Object.keys(item.tags).some((key) => !tags.includes(key)) || item.type === "way" && (!highways.includes(item.tags.highway) || item.tags.area === "yes")) throw new SnapshotValidationError("Invalid extracted feature scope");
			counts[item.type]++; if (item.type === "node") nodes.set(item.id, item);
		});
	}
	if (counts.way !== manifest.counts.way || counts.node !== manifest.counts.node || !counts.way) throw new SnapshotValidationError("Invalid feature counts");
	// A second streaming pass proves hazard membership without retaining all Finland node IDs.
	for (const entry of manifest.shards) await scan(directory, entry, function (item) { if (item.type === "way") for (let i = 0; i < item.nodes.length; i++) { const id = item.nodes[i], node = nodes.get(id); if (!node) continue; if (node.lat !== item.geometry[i].lat || node.lon !== item.geometry[i].lon) throw new SnapshotValidationError("Hazard coordinate differs from its parent way"); members.add(id); } });
	if (members.size !== nodes.size) throw new SnapshotValidationError("Hazard node without a retained parent way");
	return { directory, manifest, payloadBytes: manifest.shards.reduce((n, s) => n + s.bytes, 0), validatedAt: new Date(options.now ?? Date.now()).toISOString() };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const result = await validateSnapshot(process.argv[2], process.argv[3] ? { maxAgeHours: Number(process.argv[3]) } : {});
	console.log(JSON.stringify({ snapshotAt: result.manifest.snapshotAt, counts: result.manifest.counts, payloadBytes: result.payloadBytes }));
}
