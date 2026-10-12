import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, runtimeFiles } from "../scripts/build.mjs";

test("bundled packages contain only the extension manifest and load renamed snapshot metadata", async function () {
	const directory = await mkdtemp(join(tmpdir(), "krb-store-build-"));
	try {
		const manifest = {
			source: { url: "https://download.geofabrik.de/europe/finland-261011.osm.pbf" },
			snapshotAt: "2026-10-11T20:21:06Z",
			shards: [],
		};
		await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
		const output = join(directory, "output");
		await build(output, { snapshot: { directory, manifest } });
		async function manifests(path) {
			const found = [];
			for (const entry of await readdir(path, { withFileTypes: true })) {
				if (entry.isDirectory()) found.push(...await manifests(join(path, entry.name)));
				else if (entry.name.toLowerCase() === "manifest.json") found.push(join(path, entry.name));
			}
			return found;
		}
		for (const browser of ["chrome", "firefox"]) {
			const root = join(output, browser);
			assert.deepEqual(await manifests(root), [join(root, "manifest.json")]);
			assert.deepEqual(JSON.parse(await readFile(join(root, "data/finland/snapshot.json"))), manifest);
			assert.match(await readFile(join(root, "bundled-osm.js"), "utf8"), /bytes\("snapshot\.json"/);
			assert.ok((await readFile(join(root, "privacy.html"))).length > 0);
		}
	}
	finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("browser builds share runtime code, select the right background and exclude local files", async function () {
	const directory = await mkdtemp(join(tmpdir(), "krb-build-"));
	try {
		await build(directory);
		await writeFile(join(directory, "firefox", "stale.txt"), "stale");
		await build(directory);
		for (const browser of ["chrome", "firefox"]) {
			const output = join(directory, browser);
			const expected = [
				...runtimeFiles,
				"manifest.json",
				"icons",
				...(browser === "chrome" ? ["background-worker.js"] : []),
			].sort();
			assert.deepEqual((await readdir(output)).sort(), expected);
			const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
			assert.equal(manifest.content_scripts[0].js[0], "browser-api.js");
			const paths = [
				...manifest.content_scripts[0].js,
				...manifest.content_scripts[0].css,
				...manifest.web_accessible_resources.flatMap((entry) => entry.resources),
				...Object.values(manifest.icons),
				manifest.action.default_popup,
			];
			for (const path of paths)
				assert.ok((await readFile(join(output, path))).length > 0, `Missing ${path}`);
			for (const size of [16, 32, 48, 128]) {
				const png = await readFile(join(output, `icons/icon-${size}.png`));
				assert.equal(png.readUInt32BE(16), size);
				assert.equal(png.readUInt32BE(20), size);
			}
			if (browser === "firefox") {
				assert.deepEqual(manifest.background, {
					scripts: [
						"browser-api.js",
						"osm-cache.js",
						"osm-overrides.js",
						"local-osm.js",
						"bundled-config.js",
						"bundled-osm.js",
						"osm-updates.js",
						"hazards.js",
						"background.js",
					],
				});
				assert.equal(manifest.browser_specific_settings.gecko.id, "komoot-routing-buddy@redfellow");
			}
			else {
				assert.deepEqual(manifest.background, { service_worker: "background-worker.js" });
				assert.equal(manifest.browser_specific_settings, undefined);
			}
		}
		for (const file of runtimeFiles) {
			assert.deepEqual(
				await readFile(join(directory, "chrome", file)),
				await readFile(join(directory, "firefox", file)),
			);
		}
	}
	finally {
		await rm(directory, { recursive: true, force: true });
	}
});
