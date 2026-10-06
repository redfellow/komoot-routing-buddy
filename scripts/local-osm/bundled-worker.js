// Existing prepared files served locally; does not build or package an extension.
importScripts("/local-osm.js", "/bundled-osm.js");
(async function () {
	try {
		const store = KrbLocalOsm.create(),
			calls = [],
			bundle = KrbBundledOsm.create({
				base: "/data/",
				fetcher(path, options) {
					calls.push(path);
					return fetch(path, options);
				},
			});
		const start = performance.now();
		await bundle.importInto(store, function (p) {
			if (p.completed % 100 === 0) postMessage({ progress: p });
		});
		const imported = performance.now();
		await store.close();
		const reopened = KrbLocalOsm.create(),
			result = await reopened.query([[23.5, 61.49, 24.45, 61.51]]);
		const requests = calls.length,
			unchanged = await bundle.importInto(reopened);
		postMessage({
			result: {
				importMs: imported - start,
				status: await reopened.status(),
				covered: result.covered,
				elements: result.elements.length,
				unchanged: unchanged.unchanged,
				unchangedReads: calls.length - requests,
				providerRequests: calls.filter((p) => !p.startsWith("/data/")).length,
				storage: await navigator.storage.estimate(),
			},
		});
		await reopened.close();
	}
	catch (error) {
		postMessage({ error: error.stack || String(error) });
	}
})();
