// Shared background-side OSM acquisition and normalisation.
(function () {
	const cache = new Map();
	const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
	const CACHE_KEY = "osmHazardsCacheV4";
	let cacheReady;
	const providers = [
		"https://overpass.private.coffee/api/interpreter",
		"https://maps.mail.ru/osm/tools/overpass/api/interpreter",
		"https://overpass-api.de/api/interpreter"
	].map((url) => ({ url, retryAfter: 0, error: undefined }));
	let active;
	let identification;
	function boundsKey(bounds) {
		if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) throw new Error("Invalid map bounds");
		const [south, west, north, east] = bounds;
		const area = (north - south) * 111 * (east - west) * 111 * Math.cos((north + south) * Math.PI / 360);
		if (south < -85 || north > 85 || west < -180 || east > 180 || south >= north || west >= east || area > 25) throw new Error("Zoom in to show hazards");
		return bounds.join(",");
	}
	function contains(outer, inner) {
		return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
	}
	function expandedBounds(bounds) {
		boundsKey(bounds);
		const [s, w, n, e] = bounds;
		for (const margin of [0.2, 0.1, 0]) {
			const box = [Math.max(-85, s - (n - s) * margin), Math.max(-180, w - (e - w) * margin), Math.min(85, n + (n - s) * margin), Math.min(180, e + (e - w) * margin)];
			try { boundsKey(box); return box; }
			catch (error) { if (!margin) throw error; }
		}
	}
	async function readCache() {
		if (!cacheReady) cacheReady = (async function () {
			try {
				const saved = await globalThis.KrbBrowser?.storage?.local.get(CACHE_KEY);
				for (const entry of saved?.[CACHE_KEY] || []) {
					if (typeof entry.key === "string" && Date.now() >= entry.time && Date.now() - entry.time < CACHE_TTL && entry.data?.type === "FeatureCollection") cache.set(entry.key, entry);
				}
			}
			catch (error) { console.warn("OSM cache read failed:", error); }
		})();
		await cacheReady;
	}
	async function saveCache() {
		for (const [key, entry] of cache) if (Date.now() - entry.time >= CACHE_TTL) cache.delete(key);
		while (cache.size > 12 || JSON.stringify([...cache.values()]).length > 1500000) cache.delete(cache.keys().next().value);
		try { await globalThis.KrbBrowser?.storage?.local.set({ [CACHE_KEY]: [...cache.values()] }); }
		catch (error) { console.warn("OSM cache write failed:", error); }
	}
	function widthMetres(tags) {
		const match = String(tags.width || tags.est_width || "").trim().match(/^(\d+(?:\.\d+)?)\s*(m|cm|ft)?$/);
		return match ? Number(match[1]) * (match[2] === "cm" ? 0.01 : match[2] === "ft" ? 0.3048 : 1) : undefined;
	}
	function categories(tags) {
		const positive = (value) => typeof value === "string" && value !== "" && !["no", "none", "false"].includes(value);
		const metres = widthMetres(tags);
		return {
			mud: tags.surface?.split(";").includes("mud") || tags.obstacle?.split(";").includes("mud") || false,
			vegetation: tags.obstacle?.split(";").includes("vegetation") || positive(tags.overgrown),
			narrow: (metres > 0 && metres < 1) || tags.obstacle?.split(";").includes("narrow") || false,
			log: tags.obstacle?.split(";").some((value) => ["log", "fallen_tree", "tree_trunk"].includes(value)) || false,
			other: ["obstacle", "barrier", "hazard", "hazard:forward", "hazard:backward"].some((key) => positive(tags[key]))
		};
	}
	function iconDetails(tags) {
		const flags = categories(tags);
		const width = widthMetres(tags);
		flags.narrow = Number(width) > 0 && Number(width) <= 0.5;
		const specific = ["mud", "vegetation", "narrow", "log"].filter((key) => flags[key]);
		const icons = specific.length ? specific : flags.other && !categories(tags).narrow ? ["other"] : [];
		const tips = { mud: "Muddy surface", vegetation: "Vegetation" + (tags.overgrown ? ` · Overgrown: ${tags.overgrown}` : ""),
			narrow: widthLabel(tags) ? `Width: ${widthLabel(tags)}` : "Narrow trail", log: "Log / fallen tree", other: describe(tags) };
		return Object.fromEntries(["mud", "vegetation", "narrow", "log", "other"].flatMap((key) => [
			[`icon_${key}`, icons.includes(key)], [`tip_${key}`, tips[key]],
			[`offset_${key}`, (icons.indexOf(key) - (icons.length - 1) / 2) * 30]
		]));
	}
	function widthLabel(tags) {
		const value = String(tags.width || tags.est_width || "").trim();
		const match = value.match(/^(\d+(?:\.\d+)?)\s*(m|cm|ft)?$/);
		if (!match || Number(match[1]) <= 0) return "";
		const metres = Number(match[1]) * (match[2] === "cm" ? 0.01 : match[2] === "ft" ? 0.3048 : 1);
		return `${tags.width ? "" : "≈"}${Number(metres.toFixed(2))}m`;
	}
	function describe(tags) {
		const notes = [];
		for (const key of ["obstacle", "overgrown", "barrier", "hazard", "hazard:forward", "hazard:backward"]) {
			if (tags[key] && !["no", "none", "false"].includes(tags[key])) notes.push(`${key}: ${tags[key]}`);
		}
		if (tags.surface?.split(";").includes("mud")) notes.push("Muddy surface");
		if (tags.width) notes.push(`Width: ${tags.width}${/^\d+(\.\d+)?$/.test(tags.width) ? " m" : ""}`);
		else if (tags.est_width) notes.push(`Estimated width: ${tags.est_width}`);
		return notes.join(" · ").slice(0, 400);
	}
	function convert(elements) {
		const features = [];
		const nodes = new Set();
		const seen = new Set();
		for (const way of elements) {
			if (way.type !== "way" || !/^[0-5][+-]?$/.test(way.tags?.["mtb:scale"] || "") || way.tags?.area === "yes") continue;
			for (const id of way.nodes || []) nodes.add(id);
			const label = describe(way.tags);
			if (!label || !Array.isArray(way.geometry) || way.geometry.length < 2 || way.geometry.some((p) => !Number.isFinite(p?.lat) || !Number.isFinite(p?.lon))) continue;
			add(way, { type: "LineString", coordinates: way.geometry.map((p) => [p.lon, p.lat]) }, label);
		}
		for (const node of elements) {
			if (node.type !== "node" || !nodes.has(node.id) || !Number.isFinite(node.lat) || !Number.isFinite(node.lon)) continue;
			const label = describe(node.tags || {});
			if (label) add(node, { type: "Point", coordinates: [node.lon, node.lat] }, label);
		}
		function add(element, geometry, label) {
			const id = `${element.type}/${element.id}`;
			if (seen.has(id)) return;
			seen.add(id);
			features.push({ type: "Feature", id, properties: { label, widthMetres: widthMetres(element.tags || {}), ...iconDetails(element.tags || {}), widthLabel: geometry.type === "LineString" ? widthLabel(element.tags || {}) : "", trailRating: geometry.type === "LineString" ? `S${element.tags["mtb:scale"]}` : "", osmId: id, ...categories(element.tags || {}) }, geometry });
		}
		return { type: "FeatureCollection", features, counts: countFeatures(features) };
	}
	function countFeatures(features) {
		const counts = { total: 0, mud: 0, vegetation: 0, narrow: 0, other: 0 };
		const seen = new Set();
		for (const feature of features) {
			const id = feature.properties?.osmId || feature.id;
			if (id && seen.has(id)) continue;
			if (id) seen.add(id);
			const flags = feature.properties || {};
			const keys = ["mud", "vegetation", "narrow", "other"];
			if (keys.some((key) => flags[key] === true)) counts.total++;
			for (const key of keys) if (flags[key] === true) counts[key]++;
		}
		return counts;
	}

	let clearing;
	function clearCache() {
		if (clearing) return clearing;
		clearing = (async function () {
			await readCache();
			// Let an existing request settle so it cannot repopulate a cleared cache.
			if (active) await active.promise.catch((error) => console.debug("OSM request ended while clearing:", error.message));
			cache.clear();
			await globalThis.KrbBrowser.storage.local.set({ [CACHE_KEY]: [] });
		})().finally(function () { clearing = undefined; });
		return clearing;
	}
	async function load(bounds) {
		if (clearing) await clearing;
		boundsKey(bounds);
		await readCache();
		for (const hit of [...cache.values()].reverse()) {
			if (Date.now() - hit.time < CACHE_TTL && contains(hit.key.split(",").map(Number), bounds)) {
				// Upgrade cached icon placement without discarding successful geometry.
				for (const feature of hit.data.features) {
					const p = feature.properties;
					const width = p.widthMetres ?? Number(String(p.widthLabel || "").replace(/^≈/, "").replace(/m$/, ""));
					p.icon_narrow = width > 0 && width <= 0.5;
					const keys = ["mud", "vegetation", "narrow", "log", "other"];
					const active = keys.filter((key) => p[`icon_${key}`]);
					for (const key of keys) p[`offset_${key}`] = (active.indexOf(key) - (active.length - 1) / 2) * 30;
				}
				hit.data.counts = countFeatures(hit.data.features);
				return hit.data;
			}
		}
		if (active) {
			if (contains(active.bounds, bounds)) return active.promise;
			throw Object.assign(new Error("Another OSM area is loading"), { retryMs: 30000 });
		}
		const area = expandedBounds(bounds);
		const promise = fetchProviders(boundsKey(area));
		active = { bounds: area, promise };
		try { return await promise; }
		finally { active = undefined; }
	}
	async function fetchProviders(key) {
		await identifyRequests();
		let lastError;
		for (const provider of providers) {
			if (Date.now() < provider.retryAfter) { lastError = provider.error; continue; }
			try { return await fetchData(key, provider.url); }
			catch (error) {
				provider.error = error;
				provider.retryAfter = Date.now() + Math.max(30000, error.retryMs || 0);
				lastError = error;
				// Invalid queries and identification errors need fixing, not replaying.
				if ([400, 401, 403, 406].includes(error.status) || error.permanent) throw error;
			}
		}
		const retryMs = Math.max(1, Math.min(...providers.map((provider) => provider.retryAfter)) - Date.now());
		throw Object.assign(new Error(lastError?.message || "OSM providers temporarily unavailable"), { status: lastError?.status, retryMs, exhausted: true });
	}
	async function identifyRequests() {
		const api = globalThis.KrbBrowser;
		if (!api?.runtime) return; // Standalone research/tests use the explicit fetch header.
		if (!identification) {
			const userAgent = `KomootRoutingBuddy/${api.runtime.getManifest().version} (+https://github.com/redfellow/komoot-routing-helper)`;
			// Chromium drops User-Agent supplied directly to fetch. Limit the network
			// rule to this extension's own requests to this one endpoint.
			identification = api.declarativeNetRequest.updateDynamicRules({
				removeRuleIds: [12001, 12002, 12003],
				addRules: providers.map((provider, index) => ({
					id: 12001 + index, priority: 1,
					action: { type: "modifyHeaders", requestHeaders: [{ header: "user-agent", operation: "set", value: userAgent }] },
					condition: {
						urlFilter: `|${provider.url}|`,
						initiatorDomains: [new URL(api.runtime.getURL("")).hostname],
						resourceTypes: ["xmlhttprequest"], requestMethods: ["post"]
					}
				}))
			}).catch(function (error) { identification = undefined; throw error; });
		}
		await identification;
	}
	async function fetchData(key, endpoint) {
		const query = `[out:json][timeout:20];way["highway"~"^(path|track|footway|bridleway|cycleway)$"]["mtb:scale"~"^[0-5][+-]?$"](${key})->.trails;.trails out body geom;node(w.trails)[~"^(obstacle|overgrown|barrier|hazard|hazard:forward|hazard:backward)$"~"."];out body;`;
		try {
			const response = await fetch(endpoint, {
				headers: { "Accept": "application/json", "User-Agent": `KomootRoutingBuddy/${globalThis.KrbBrowser?.runtime?.getManifest?.().version || "development"} (+https://github.com/redfellow/komoot-routing-helper)` },
				method: "POST", body: new URLSearchParams({ data: query }), credentials: "omit", signal: AbortSignal.timeout(25000)
			});
			if (!response.ok) {
				const retry = response.headers.get("Retry-After");
				const retryMs = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry || "") - Date.now();
				await response.body?.cancel();
				throw Object.assign(new Error(`${new URL(endpoint).hostname}: HTTP ${response.status}`), { status: response.status, retryMs: Number.isFinite(retryMs) ? retryMs : 30000 });
			}
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let text = "";
			let bytes = 0;
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				bytes += value.byteLength;
				if (bytes > 5000000) { await reader.cancel(); throw Object.assign(new Error("Too much OSM data; zoom in"), { permanent: true }); }
				text += decoder.decode(value, { stream: true });
			}
			const json = JSON.parse(text + decoder.decode());
			if (json.remark || !Array.isArray(json.elements)) throw new Error("OSM returned incomplete data");
			const data = convert(json.elements);
			cache.set(key, { key, time: Date.now(), data });
			await saveCache();
			return data;
		}
		catch (error) {
			if (error.name === "TimeoutError") error.message = "OSM request timed out";
			throw error;
		}
	}
	globalThis.KrbHazards = { load, clearCache, convert, boundsKey, expandedBounds, identifyRequests, countFeatures };
})();
