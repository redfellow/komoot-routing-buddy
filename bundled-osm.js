// Prepared release data is private to the extension origin; no public-provider download on install.
(function () {
	function create({ fetcher = globalThis.fetch, base = globalThis.KrbBrowser?.runtime.getURL("data/finland/") || "data/finland/", enabled = globalThis.KrbBundledData?.available !== false } = {}) {
		async function bytes(path, maximum, optional = false) {
			const response = await fetcher(base + path, { credentials: "omit" });
			if (optional && response.status === 404) return undefined;
			if (!response.ok) throw new Error(`Bundled Finland data: HTTP ${response.status}`);
			const reader = response.body.getReader(), chunks = []; let size = 0;
			try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > maximum) throw new Error("Oversized bundled data file"); chunks.push(value); } }
			finally { await reader.cancel(); reader.releaseLock(); }
			return new Uint8Array(await new Blob(chunks).arrayBuffer());
		}
		async function manifest() {
			if (!enabled) return undefined;
			const data = await bytes("manifest.json", 8 * 1024 * 1024);
			if (!data) return undefined;
			const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)); KrbLocalOsm.validateManifest(parsed); return parsed;
		}
		async function importInto(store, progress) {
			const bundled = await manifest(); if (!bundled) throw new Error("No bundled Finland snapshot; import a prepared folder instead");
			const active = await store.status();
			if (active && Date.parse(active.snapshotAt) >= Date.parse(bundled.snapshotAt)) return { unchanged: true };
			await store.importSnapshot(bundled, async function (entry) { const data = await bytes(entry.file, entry.bytes); if (data.length !== entry.bytes) throw new Error("Incomplete bundled Finland file"); return data; }, { onProgress: (p) => progress?.({ ...p, phase: "import" }) });
			return { unchanged: false };
		}
		return { manifest, importInto };
	}
	globalThis.KrbBundledOsm = { create };
})();
