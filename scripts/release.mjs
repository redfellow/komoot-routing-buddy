// Run only when the user explicitly asks to package a release.
import { mkdtemp, mkdir, rename, rm, stat, readFile, copyFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "./build.mjs";
import { discoverLatest, policy, releaseSelection } from "./local-osm/release-data.mjs";
import { validateSnapshot } from "./local-osm/validate.mjs";
class ReleaseError extends Error {
	constructor(message) {
		super(message);
		this.name = "ReleaseError";
	}
}
const root = fileURLToPath(new URL("../", import.meta.url));
async function webExt(args) {
	const command = join(
		root,
		"node_modules",
		".bin",
		process.platform === "win32" ? "web-ext.cmd" : "web-ext",
	);
	await new Promise(function (resolve, reject) {
		const child = spawn(command, args, { cwd: root, stdio: "inherit" });
		child.on("error", reject);
		child.on("exit", function (code) {
			return code === 0 ? resolve() : reject(new ReleaseError(`web-ext exited with ${code}`));
		});
	});
}
export async function packageRelease() {
	const config = await policy(),
		expectedSource = await discoverLatest(),
		options = { maxAgeHours: config.maxAgeHours, expectedSource };
	const snapshot = await releaseSelection(root, options);
	await build(join(root, "dist"), { snapshot });
	for (const browser of ["chrome", "firefox"])
		await validateSnapshot(join(root, "dist", browser, "data", "finland"), options);
	await webExt(["lint", "--source-dir", "dist/firefox", "--warnings-as-errors"]);
	const temporary = await mkdtemp(join(tmpdir(), "krb-release-"));
	let publication;
	try {
		const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
		if (!/^\d+\.\d+\.\d+$/.test(manifest.version))
			throw new ReleaseError("Unexpected release version");
		const files = [];
		for (const browser of ["chrome", "firefox"]) {
			const name = `${browser}--komoot-routing-buddy-${manifest.version}.zip`;
			await webExt([
				"build",
				"--source-dir",
				`dist/${browser}`,
				"--artifacts-dir",
				temporary,
				"--filename",
				name,
				"--overwrite-dest",
			]);
			if (browser === "firefox" && (await stat(join(temporary, name))).size > 200000000)
				throw new ReleaseError(
					"Firefox package exceeds Mozilla's 200 MB signing-submission limit; review distribution before releasing",
				);
			files.push(name);
		}
		await mkdir(join(root, "artifacts"), { recursive: true });
		publication = await mkdtemp(join(root, "artifacts", ".release-"));
		for (const file of files) await copyFile(join(temporary, file), join(publication, file));
		for (const file of files) await rename(join(publication, file), join(root, "artifacts", file));
		console.log("Validated release ZIPs written to artifacts/ with bundled Finland data.");
	}
	finally {
		await rm(temporary, { recursive: true, force: true });
		if (publication) await rm(publication, { recursive: true, force: true });
	}
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	await packageRelease();
