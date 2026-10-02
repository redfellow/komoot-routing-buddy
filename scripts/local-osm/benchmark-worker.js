/* Standalone benchmark: never loaded by the extension. */
importScripts("/local-osm.js", "/osm-cache.js", "/hazards.js", "/route-check.js");
(async function () {
	try {
		const manifest = await (await fetch("/manifest.json")).json();
		let store = KrbLocalOsm.create();
		const start = performance.now();
		await store.importSnapshot(manifest, async function (entry) {
			const response = await fetch(`/data/${entry.file}`);
			if (!response.ok) throw new Error(`Shard HTTP ${response.status}`);
			return new Uint8Array(await response.arrayBuffer());
		}, { onProgress(p) { if (p.completed % 100 === 0) postMessage({ progress: p }); } });
		const importMs = performance.now() - start;
		await store.close(); store = KrbLocalOsm.create();
		const route = { type: "Feature", geometry: { type: "LineString", coordinates: [[23.5, 61.5], [24.45, 61.5]] } };
		const boxes = KrbRouteCheck.areas(route).map((b) => [b[1], b[0], b[3], b[2]]);
		const runs = [];
		for (const label of ["cold-store", "warm-store"]) {
			const start = performance.now(), result = await store.query(boxes), fetched = performance.now();
			const features = KrbHazards.convertRoute(result.elements).features, converted = performance.now();
			const analysis = KrbRouteCheck.analyse(route, features, {});
			runs.push({ label, lookupMs: fetched - start, conversionMs: converted - fetched, analysisMs: performance.now() - converted, totalMs: performance.now() - start,
				elements: result.elements.length, features: features.length, shardsRead: result.shardsRead, coveredAreas: result.covered.filter(Boolean).length, areas: boxes.length,
				warnings: analysis.warnings.length, checkedKm: analysis.checkedDistance / 1000, distanceKm: analysis.distance / 1000, stats: store.stats() });
		}
		postMessage({ result: { userAgent: navigator.userAgent, importMs, status: await store.status(), runs, storage: await navigator.storage.estimate() } });
		await store.close();
	}
	catch (error) { postMessage({ error: error.stack || String(error) }); }
})();
