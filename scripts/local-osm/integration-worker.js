// Exercises production acquisition and route collection; served only by the benchmark harness.
importScripts("/local-osm.js", "/osm-cache.js", "/hazards.js", "/route-check.js");
(async function () {
	try {
		const manifest = await (await fetch("/manifest.json")).json(), store = KrbLocalOsm.create();
		await store.importSnapshot(manifest, async function (entry) { return new Uint8Array(await (await fetch(`/data/${entry.file}`)).arrayBuffer()); }, {
			onProgress(p) { if (p.completed % 100 === 0) postMessage({ progress: p }); }
		});
		await store.close();
		let networkCalls = 0;
		globalThis.fetch = async function () { networkCalls++; throw new Error("Unexpected API request in covered Finland"); };
		const runs = [];
		for (const longitude of [24.45, 25.4]) {
			const route = { type: "Feature", geometry: { type: "LineString", coordinates: [[23.5, 61.5], [longitude, 61.5]] } };
			for (const label of ["first-query", "repeat-query"]) {
				const start = performance.now(); let progress;
				const features = await KrbRouteCheck.collectWithRetry(route, async function (bounds, following) { return { data: await KrbHazards.loadRoute(bounds, following) }; }, {
					localLoad: async (bounds) => ({ data: await KrbHazards.loadLocalRoute(bounds) }), progress(p) { progress = p; }, concurrency: 2
				});
				const collected = performance.now(), analysis = KrbRouteCheck.analyse(route, features, {});
				runs.push({ label, distanceKm: analysis.distance / 1000, collectionMs: collected - start, totalMs: performance.now() - start, features: features.length, warnings: analysis.warnings.length, checkedKm: analysis.checkedDistance / 1000, completed: progress.completed, cached: progress.cached, downloaded: progress.downloaded });
			}
		}
		const map = await KrbHazards.load([61.49, 23.75, 61.50, 23.77]);
		postMessage({ result: { userAgent: navigator.userAgent, runs, networkCalls, map: { cacheSource: map.cacheSource, features: map.features.length, counts: map.counts } } });
	}
	catch (error) { postMessage({ error: error.stack || String(error) }); }
})();
