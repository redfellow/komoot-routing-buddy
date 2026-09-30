// Shared background-side OSM acquisition and normalisation.
(function () {
	const cacheStore = globalThis.KrbOsmCache.create();
	let cache;
	const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
	function displayData(data) {
		const features = data.features.filter((f) => f.geometry.type === "LineString" ? f.properties.trailRating && f.properties.label : f.properties.ratedParent);
		return { type: "FeatureCollection", features, counts: countFeatures(features) };
	}
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
		cache = await cacheStore.list();
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
			log: [tags.obstacle, tags.barrier].some((tag) => tag?.split(";").some((value) => ["log", "fallen_tree", "tree_trunk"].includes(value.trim()))),
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
	function convertRoute(elements) {
		return convert(elements, true);
	}
	function convert(elements, forRoute = false) {
		const features = [];
		const nodes = new Set();
		const parentWays = new Map();
		const ratedNodes = new Set();
		const seen = new Set();
		for (const way of elements) {
			if (way.type !== "way" || way.tags?.area === "yes") continue;
			if (forRoute ? !/^(path|track|footway|bridleway|cycleway)$/.test(way.tags?.highway || "") : !/^[0-5][+-]?$/.test(way.tags?.["mtb:scale"] || "")) continue;
			const label = describe(way.tags);
			if (!Array.isArray(way.geometry) || way.geometry.length < 2 || way.geometry.some((p) => !Number.isFinite(p?.lat) || !Number.isFinite(p?.lon))) continue;
			for (const id of way.nodes || []) {
				nodes.add(id);
				if (/^[0-5][+-]?$/.test(way.tags?.["mtb:scale"] || "")) ratedNodes.add(id);
				if (!parentWays.has(id)) parentWays.set(id, new Set());
				parentWays.get(id).add(`way/${way.id}`);
			}
			if (!forRoute && !label) continue;
			add(way, { type: "LineString", coordinates: way.geometry.map((p) => [p.lon, p.lat]) }, label);
		}
		for (const node of elements) {
			if (node.type !== "node" || !nodes.has(node.id) || !Number.isFinite(node.lat) || !Number.isFinite(node.lon)) continue;
			const label = describe(node.tags || {});
			if (label) add(node, { type: "Point", coordinates: [node.lon, node.lat] }, label);
		}
		function add(element, geometry, label) {
			const id = `${element.type}/${element.id}`;
			const featureId = id;
			if (seen.has(featureId)) return;
			seen.add(featureId);
			features.push({ type: "Feature", id: featureId, properties: { ...(forRoute ? { parentWayIds: geometry.type === "Point" ? [...(parentWays.get(element.id) || [])] : [], ratedParent: geometry.type === "Point" && ratedNodes.has(element.id), layer: element.tags?.layer, bridge: element.tags?.bridge, tunnel: element.tags?.tunnel, widthEstimated: !element.tags?.width && Boolean(element.tags?.est_width) } : {}), label, widthMetres: widthMetres(element.tags || {}), ...iconDetails(element.tags || {}), widthLabel: geometry.type === "LineString" ? widthLabel(element.tags || {}) : "", trailRating: geometry.type === "LineString" && /^[0-5][+-]?$/.test(element.tags?.["mtb:scale"] || "") ? `S${element.tags["mtb:scale"]}` : "", osmId: id, ...categories(element.tags || {}) }, geometry });
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
			await cacheStore.clear();
		})().finally(function () { clearing = undefined; });
		return clearing;
	}
	async function cachedCoverage(bounds, forRoute = false) {
		let uncovered = [bounds];
		const selected = [];
		for (const entry of [...cache.values()].reverse()) {
			if (Date.now() - entry.time >= CACHE_TTL || forRoute && !entry.routeComplete) continue;
			const box = entry.bounds;
			let used = false;
			uncovered = uncovered.flatMap(function (b) {
				const s = Math.max(b[0], box[0]), w = Math.max(b[1], box[1]), n = Math.min(b[2], box[2]), e = Math.min(b[3], box[3]);
				if (s >= n || w >= e) return [b];
				used = true;
				return [[b[0], b[1], s, b[3]], [n, b[1], b[2], b[3]], [s, b[1], n, w], [s, e, n, b[3]]].filter((r) => r[0] < r[2] && r[1] < r[3]);
			});
			if (used) selected.push(entry);
			if (!uncovered.length) {
				const unique = new Map();
				for (const hit of selected) {
					const payload = await cacheStore.read(hit.id);
					if (!payload) return undefined;
					for (const feature of payload.data.features) {
						if (!forRoute && hit.routeComplete && !(feature.geometry.type === "LineString" ? feature.properties.trailRating && feature.properties.label : feature.properties.ratedParent)) continue;
						const id = feature.properties?.osmId || feature.id;
						const previous = unique.get(id);
						if (!previous) unique.set(id, feature);
						else if (forRoute && feature.geometry.type === "Point") unique.set(id, { ...previous, properties: { ...previous.properties, parentWayIds: [...new Set([...(previous.properties.parentWayIds || []), ...(feature.properties.parentWayIds || [])])] } });
					}
				}
				const features = [...unique.values()];
				const data = { type: "FeatureCollection", features, counts: countFeatures(features) };
				return forRoute ? { ...data, cacheSource: "cache" } : data;
			}
		}
	}
	async function loadRoute(bounds) { return load(bounds, false, true); }
	async function load(bounds, prefetch = false, forRoute = false) {
		if (clearing) await clearing;
		boundsKey(bounds);
		await readCache();
		for (const hit of [...cache.values()].reverse()) {
			if ((!forRoute || hit.routeComplete) && Date.now() - hit.time < CACHE_TTL && contains(hit.bounds, bounds)) {
				const payload = await cacheStore.read(hit.id);
				if (!payload) continue;
				const data = payload.data;
				if (forRoute) return { ...data, cacheSource: payload.source };
				if (hit.routeComplete) return displayData(data);
				// Upgrade cached icon placement without discarding successful geometry.
				for (const feature of data.features) {
					const p = feature.properties;
					const width = p.widthMetres ?? Number(String(p.widthLabel || "").replace(/^≈/, "").replace(/m$/, ""));
					p.icon_narrow = width > 0 && width <= 0.5;
					const keys = ["mud", "vegetation", "narrow", "log", "other"];
					const active = keys.filter((key) => p[`icon_${key}`]);
					for (const key of keys) p[`offset_${key}`] = (active.indexOf(key) - (active.length - 1) / 2) * 30;
				}
				data.counts = countFeatures(data.features);
				return data;
			}
		}
		const combined = await cachedCoverage(bounds, forRoute);
		if (combined) return combined;
		if (active) {
			await active.promise.catch((error) => console.debug("OSM request settled:", error.message));
			return load(bounds, prefetch, forRoute);
		}
		const promise = fetchProviders(boundsKey(expandedBounds(bounds)), forRoute);
		active = { promise };
		try { return await promise; }
		finally { active = undefined; }
	}
	async function fetchProviders(key, forRoute = false) {
		await identifyRequests();
		let lastError;
		for (const provider of providers) {
			if (Date.now() < provider.retryAfter) { lastError = provider.error; continue; }
			try { return await fetchData(key, provider.url, forRoute); }
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
	async function fetchData(key, endpoint, forRoute = false) {
		const ratingFilter = forRoute ? "" : `["mtb:scale"~"^[0-5][+-]?$"]`;
		const query = `[out:json][timeout:20];way["highway"~"^(path|track|footway|bridleway|cycleway)$"]${ratingFilter}(${key})->.trails;.trails out body geom;node(w.trails)[~"^(obstacle|overgrown|barrier|hazard|hazard:forward|hazard:backward)$"~"."];out body;`;
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
			const data = forRoute ? convertRoute(json.elements) : convert(json.elements);
			const entry = { key, time: Date.now(), accessed: Date.now(), data, routeComplete: forRoute };
			try { await cacheStore.put(entry); }
			catch (error) { console.warn("OSM area could not be cached:", error); }
			return forRoute ? { ...data, cacheSource: "network" } : data;
		}
		catch (error) {
			if (error.name === "TimeoutError") error.message = "OSM request timed out";
			throw error;
		}
	}
	globalThis.KrbHazards = { load, loadRoute, clearCache, cacheStats: cacheStore.stats, convert, convertRoute, boundsKey, expandedBounds, identifyRequests, countFeatures };
})();
