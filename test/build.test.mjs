import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, runtimeFiles } from "../scripts/build.mjs";

test("browser builds share runtime code, select the right background and exclude local files", async function () {
	const directory = await mkdtemp(join(tmpdir(), "krb-build-"));
	try {
		await build(directory);
		await writeFile(join(directory, "firefox", "stale.txt"), "stale");
		await build(directory);
		for (const browser of ["chrome", "firefox"]) {
			const output = join(directory, browser);
			const expected = [...runtimeFiles, "manifest.json", "icons", ...(browser === "chrome" ? ["background-worker.js"] : [])].sort();
			assert.deepEqual((await readdir(output)).sort(), expected);
			const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
			assert.equal(manifest.content_scripts[0].js[0], "browser-api.js");
			const paths = [...manifest.content_scripts[0].js, ...manifest.content_scripts[0].css,
				...manifest.web_accessible_resources.flatMap((entry) => entry.resources),
				...Object.values(manifest.icons), manifest.action.default_popup];
			for (const path of paths) assert.ok((await readFile(join(output, path))).length > 0, `Missing ${path}`);
			for (const size of [16, 32, 48, 128]) {
				const png = await readFile(join(output, `icons/icon-${size}.png`));
				assert.equal(png.readUInt32BE(16), size);
				assert.equal(png.readUInt32BE(20), size);
			}
			if (browser === "firefox") {
				assert.deepEqual(manifest.background, { scripts: ["browser-api.js", "osm-cache.js", "hazards.js", "background.js"] });
				assert.equal(manifest.browser_specific_settings.gecko.id, "komoot-routing-buddy@redfellow");
			}
			else {
				assert.deepEqual(manifest.background, { service_worker: "background-worker.js" });
				assert.equal(manifest.browser_specific_settings, undefined);
			}
		}
		for (const file of runtimeFiles) {
			assert.deepEqual(await readFile(join(directory, "chrome", file)), await readFile(join(directory, "firefox", file)));
		}
	}
	finally {
		await rm(directory, { recursive: true, force: true });
	}
});
