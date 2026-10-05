import sharp from "sharp";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
export const runtimeFiles = [
	"browser-api.js", "osm-cache.js", "osm-overrides.js", "local-osm.js", "bundled-config.js", "bundled-osm.js", "osm-updates.js", "hazards.js", "background.js", "settings.js", "sidebar.js", "route-check.js", "route-dialog.js", "content.js",
	"local-data.html", "local-data.js", "local-data-worker.js", "osm-md5.js", "osm-download.js", "osm-pbf.js", "osm-prepare.js", "hazard-icons.png", "map-bridge.js", "planner.css", "popup.html", "popup.css", "popup.js"
];

export function bundledFiles(snapshot) {
	if (!snapshot) return [];
	return ["manifest.json", ...snapshot.manifest.shards.map((entry) => entry.file)].map((file) => ({ source: join(snapshot.directory, file), target: join("data", "finland", file) }));
}

export async function build(output = join(root, "dist"), { snapshot } = {}) {
	const base = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
	for (const browser of ["chrome", "firefox"]) {
		const directory = join(output, browser);
		const manifest = structuredClone(base);
		const files = [...runtimeFiles];
		manifest.icons = Object.fromEntries([16, 32, 48, 128].map((size) => [String(size), `icons/icon-${size}.png`]));
		manifest.action.default_icon = { "16": manifest.icons["16"], "32": manifest.icons["32"] };
		if (browser === "firefox") {
			manifest.background = { scripts: ["browser-api.js", "osm-cache.js", "osm-overrides.js", "local-osm.js", "bundled-config.js", "bundled-osm.js", "osm-updates.js", "hazards.js", "background.js"] };
			manifest.browser_specific_settings = {
				gecko: {
					id: "komoot-routing-buddy@redfellow",
					strict_min_version: "142.0",
					data_collection_permissions: { required: ["locationInfo"] }
				}
			};
		}
		else {
			files.push("background-worker.js");
		}
		await rm(directory, { recursive: true, force: true });
		await mkdir(directory, { recursive: true });
		await mkdir(join(directory, "icons"));
		for (const size of [16, 32, 48, 128]) {
			await sharp(join(root, "icon-rounded.png")).resize(size, size).png().toFile(join(directory, `icons/icon-${size}.png`));
		}
		if (snapshot) {
			await mkdir(join(directory, "data", "finland"), { recursive: true });
			for (const file of bundledFiles(snapshot)) await copyFile(file.source, join(directory, file.target));
			await writeFile(join(directory, "data", "finland", "LICENSE.txt"), "Derived OpenStreetMap database · © OpenStreetMap contributors\nLicensed under the Open Database License 1.0 (ODbL).\nhttps://opendatacommons.org/licenses/odbl/1-0/\nhttps://www.openstreetmap.org/copyright\nSource: " + snapshot.manifest.source.url + "\nSnapshot: " + snapshot.manifest.snapshotAt + "\n");
		}
		for (const file of files) await copyFile(join(root, file), join(directory, file));
		if (snapshot) await writeFile(join(directory, "bundled-config.js"), "globalThis.KrbBundledData = { available: true };\n");
		await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, "\t") + "\n");
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await build();
	console.log("Built dist/chrome and dist/firefox");
}
