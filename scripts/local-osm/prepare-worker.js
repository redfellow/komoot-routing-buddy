// Full-source browser feasibility measurement; runs only in a disposable benchmark profile.
importScripts("/osm-pbf.js", "/osm-prepare.js", "/local-osm.js");
(async function () {
	try {
		const native = await (await fetch("/manifest.json")).json(),
			builder = KrbOsmPrepare.create();
		const size = native.source.bytes,
			chunkSize = 8 * 1024 * 1024;
		let cached,
			cachedAt = -1,
			lastProgress = 0;
		const source = {
			size,
			async read(offset, length) {
				const result = new Uint8Array(length);
				let written = 0;
				while (written < length) {
					const at = Math.floor((offset + written) / chunkSize) * chunkSize;
					if (at !== cachedAt) {
						const response = await fetch("/source.pbf", {
							headers: { Range: `bytes=${at}-${Math.min(size - 1, at + chunkSize - 1)}` },
						});
						if (response.status !== 206) throw new Error("Benchmark source must support ranges");
						cached = new Uint8Array(await response.arrayBuffer());
						cachedAt = at;
					}
					const start = offset + written - at,
						amount = Math.min(length - written, cached.length - start);
					if (amount <= 0) throw new Error("Truncated benchmark source");
					result.set(cached.subarray(start, start + amount), written);
					written += amount;
				}
				return result;
			},
		};
		const started = performance.now();
		const manifest = await builder.prepare(source, native.coverage, native.source, {
			progress(p) {
				if (performance.now() - lastProgress > 10000) {
					postMessage({ progress: p });
					lastProgress = performance.now();
				}
			},
		});
		const prepared = performance.now();
		function canonical(item) {
			return JSON.stringify({
				type: item.type,
				id: item.id,
				tags: Object.fromEntries(Object.entries(item.tags).sort()),
				...(item.type === "way"
					? { nodes: item.nodes, geometry: item.geometry.map((p) => ({ lat: p.lat, lon: p.lon })) }
					: { lat: item.lat, lon: item.lon }),
			});
		}
		async function lines(bytes) {
			const text = await new Response(
				new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
			).text();
			return text
				.trimEnd()
				.split("\n")
				.map((line) => canonical(JSON.parse(line)));
		}
		let records = 0;
		if (JSON.stringify(manifest.counts) !== JSON.stringify(native.counts))
			throw new Error("Browser/native feature counts differ");
		for (const entry of manifest.shards) {
			const a = new Set(await lines(await builder.loadShard(entry))),
				b = await lines(await (await fetch(`/data/${entry.file}`)).arrayBuffer());
			if (a.size !== b.length || b.some((line) => !a.has(line)))
				throw new Error(`Browser/native records differ in ${entry.file}`);
			records += b.length;
		}
		const compared = performance.now(),
			store = KrbLocalOsm.create();
		await store.importSnapshot(manifest, builder.loadShard);
		const metrics = (await builder.status()).metrics;
		postMessage({
			result: {
				userAgent: navigator.userAgent,
				prepareSeconds: (prepared - started) / 1000,
				comparisonSeconds: (compared - prepared) / 1000,
				importSeconds: (performance.now() - compared) / 1000,
				recordsCompared: records,
				snapshotAt: manifest.snapshotAt,
				counts: manifest.counts,
				payloadBytes: manifest.shards.reduce((n, s) => n + s.bytes, 0),
				metrics,
				storage: await navigator.storage.estimate(),
			},
		});
		await store.close();
		await builder.close();
	}
	catch (error) {
		postMessage({ error: error.stack || String(error) });
	}
})();
