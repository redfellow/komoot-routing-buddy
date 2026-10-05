importScripts("local-osm.js", "osm-md5.js", "osm-download.js", "osm-pbf.js", "osm-prepare.js");
self.onmessage = async function (event) {
	const store = KrbLocalOsm.create(), downloader = KrbOsmDownload.create(), builder = KrbOsmPrepare.create();
	let lastProgress = 0;
	function progress(value) {
		if (performance.now() - lastProgress < 250 && value.completed !== value.total) return;
		lastProgress = performance.now(); self.postMessage({ progress: value });
	}
	async function run() {
		if (event.data.type === "update") {
			const info = await downloader.discover(AbortSignal.timeout(120000)), active = await store.status();
			if (active?.source?.md5 === info.md5 && active.source.bytes === info.bytes) return { unchanged: true };
			const source = await downloader.download(info, { progress, signal: AbortSignal.timeout(30 * 60 * 1000) });
			const { coverage, ...metadata } = info;
			const manifest = await builder.prepare(source, coverage, metadata, { progress });
			const current = await store.status();
			if (current && Date.parse(manifest.snapshotAt) <= Date.parse(current.snapshotAt)) return { unchanged: true };
			await store.importSnapshot(manifest, builder.loadShard, { onProgress: (p) => progress({ ...p, phase: "import" }) });
			return { unchanged: false };
		}
		const files = new Map();
		for (const file of event.data.files) {
			if (files.has(file.name)) throw new Error("Select one snapshot folder, without duplicate filenames"); files.set(file.name, file);
		}
		const manifestFile = files.get("manifest.json");
		if (!manifestFile || manifestFile.size > 8 * 1024 * 1024) throw new Error("Missing or oversized snapshot manifest");
		const manifest = JSON.parse(await manifestFile.text());
		await store.importSnapshot(manifest, async function (entry) {
			const file = files.get(entry.file);
			if (!file || file.size !== entry.bytes) throw new Error(`Missing or invalid snapshot file: ${entry.file}`);
			return new Uint8Array(await file.arrayBuffer());
		}, { onProgress: (p) => progress({ ...p, phase: "import" }) });
		return { unchanged: false };
	}
	try {
		if (!navigator.locks) throw new Error("This browser does not support coordinated local data updates");
		await navigator.locks.request("krb-osm-data-update", { ifAvailable: true }, async function (lock) {
			if (!lock) throw new Error("A Finland data update is already running in another tab");
			const result = await run();
			let cleanupWarning;
			try { await store.cleanup(); await builder.discard(); await downloader.discard(); }
			catch (error) { cleanupWarning = `Data is ready, but temporary-file cleanup failed: ${error.message}`; }
			self.postMessage({ done: true, ...result, cleanupWarning, status: await store.status() });
		});
	}
	catch (error) { self.postMessage({ error: error.message }); }
	finally {
		for (const resource of [store, builder, downloader]) {
			try { await resource.close(); }
			catch (error) { console.warn("Local update store close failed:", error.message); }
		}
	}
};
