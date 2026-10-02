importScripts("local-osm.js");
self.onmessage = async function (event) {
	const store = KrbLocalOsm.create();
	try {
		const files = new Map();
		for (const file of event.data.files) {
			if (files.has(file.name)) throw new Error("Select one snapshot folder, without duplicate filenames");
			files.set(file.name, file);
		}
		const manifestFile = files.get("manifest.json");
		if (!manifestFile || manifestFile.size > 8 * 1024 * 1024) throw new Error("Missing or oversized snapshot manifest");
		const manifest = JSON.parse(await manifestFile.text());
		await store.importSnapshot(manifest, async function (entry) {
			const file = files.get(entry.file);
			if (!file || file.size !== entry.bytes) throw new Error(`Missing or invalid snapshot file: ${entry.file}`);
			return new Uint8Array(await file.arrayBuffer());
		}, { onProgress: (progress) => self.postMessage({ progress }) });
		self.postMessage({ done: true, status: await store.status() });
	}
	catch (error) { self.postMessage({ error: error.message }); }
	finally {
		try { await store.close(); }
		catch (error) { console.warn("Local import store close failed:", error.message); }
	}
};
