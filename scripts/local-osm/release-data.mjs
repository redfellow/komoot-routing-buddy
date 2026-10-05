import { readFile, writeFile, mkdir, rename, access } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { validateSnapshot, validateFreshness, SnapshotValidationError } from "./validate.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url)), base = "https://download.geofabrik.de/europe/";
const context = {}; runInNewContext(await readFile(new URL("../../osm-download.js", import.meta.url), "utf8"), context);
async function metadata(response, maximum) {
	if (!response.ok) throw new SnapshotValidationError(`Provider metadata HTTP ${response.status}`);
	const reader = response.body.getReader(), chunks = []; let size = 0;
	try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > maximum) throw new SnapshotValidationError("Provider metadata exceeds limit"); chunks.push(value); } }
	finally { await reader.cancel(); reader.releaseLock(); }
	return new TextDecoder("utf-8", { fatal: true }).decode(await new Blob(chunks).arrayBuffer());
}
export async function discoverLatest(fetcher = fetch) {
	const options = { signal: AbortSignal.timeout(120000), headers: { "User-Agent": "KomootRoutingBuddy-release-data/1" }, cache: "no-store" };
	const response = await fetcher(base + "finland-latest.osm.pbf", { ...options, method: "HEAD" });
	const url = response.url, bytes = Number(response.headers.get("Content-Length"));
	if (!response.ok || !/^https:\/\/download\.geofabrik\.de\/europe\/finland-\d{6}\.osm\.pbf$/.test(url) || !Number.isSafeInteger(bytes) || bytes <= 0) throw new SnapshotValidationError("Latest dated Finland source is unavailable");
	const md5 = (await metadata(await fetcher(url + ".md5", options), 4096)).trim().split(/\s+/)[0].toLowerCase();
	if (!/^[a-f0-9]{32}$/.test(md5)) throw new SnapshotValidationError("Invalid provider checksum");
	const coverage = context.KrbOsmDownload.polygon(await metadata(await fetcher(base + "finland.poly", options), 2 * 1024 * 1024));
	return { url, bytes, md5, coverage };
}
export async function policy(project = root) {
	const value = JSON.parse(await readFile(join(project, "scripts/local-osm/release-policy.json"), "utf8"));
	if (!Number.isFinite(value.maxAgeHours) || value.maxAgeHours <= 0) throw new SnapshotValidationError("Release source-age policy has not been confirmed");
	return value;
}
export async function releaseSelection(project = root, options = {}) {
	const data = join(project, "local-osm-data"), pointer = JSON.parse(await readFile(join(data, "release.json"), "utf8"));
	if (!/^finland-\d{6}-[a-f0-9-]+$/.test(pointer.directory)) throw new SnapshotValidationError("Invalid prepared release-data pointer");
	const directory = join(data, pointer.directory), manifest = await readFile(join(directory, "manifest.json"));
	if (createHash("sha256").update(manifest).digest("hex") !== pointer.manifestSha256) throw new SnapshotValidationError("Prepared release manifest changed after selection");
	return validateSnapshot(directory, options);
}
export async function publishSelection(project, result) {
	const directory = result.directory.split(/[\\/]/).at(-1), data = join(project, "local-osm-data");
	if (!/^finland-\d{6}-[a-f0-9-]+$/.test(directory) || resolve(result.directory) !== resolve(data, directory)) throw new SnapshotValidationError("Release data must be inside the generated data directory");
	const manifestSha256 = createHash("sha256").update(await readFile(join(result.directory, "manifest.json"))).digest("hex");
	const temporary = join(data, `.release-${randomUUID()}.json`);
	await writeFile(temporary, JSON.stringify({ directory, manifestSha256, snapshotAt: result.manifest.snapshotAt, validatedAt: result.validatedAt }, null, 2) + "\n");
	await rename(temporary, join(data, "release.json"));
}
async function run(command, args) {
	await new Promise(function (resolve, reject) { const child = spawn(command, args, { cwd: root, stdio: "inherit" }); child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve() : reject(new SnapshotValidationError(`Data preparation exited with ${code}`))); });
}
export async function prepareReleaseData() {
	const config = await policy(), latest = await discoverLatest(), options = { maxAgeHours: config.maxAgeHours, expectedSource: latest };
	let result;
	try { result = await releaseSelection(root, options); }
	catch (error) {
		console.info(`Preparing latest Finland data: ${error.message}`);
		const directory = join(root, "local-osm-data", `finland-${latest.url.match(/finland-(\d{6})/)[1]}-${latest.md5.slice(0, 8)}-${randomUUID().slice(0, 8)}`);
		await mkdir(join(root, "local-osm-data"), { recursive: true });
		const python = join(root, ".venv-local-osm", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
		await access(python).catch(() => { throw new SnapshotValidationError("Set up .venv-local-osm with the pinned requirements before preparing a release"); });
		await run(python, ["scripts/local-osm/prepare.py", "--source-url", latest.url, "--output", directory]);
		result = await validateSnapshot(directory, options);
	}
	// Do not publish a pointer if the provider advanced while preparation was running.
	validateFreshness(result.manifest, { maxAgeHours: config.maxAgeHours, expectedSource: await discoverLatest() });
	await publishSelection(root, result);
	return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const result = await prepareReleaseData(); console.log(`Release Finland snapshot: ${result.manifest.snapshotAt} · ${result.payloadBytes} bytes`);
}
