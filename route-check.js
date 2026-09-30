// Pure route analysis plus cancellable, sequential area collection.
(function () {
	const SUCCESS = "The route doesn't contain issues according to Komoot & OSM data.";
	function preferences(value = {}) {
		return { maximumLevel: /^S[0-5]$/.test(value.maximumLevel) ? value.maximumLevel : "S1",
			minimumWidth: Number.isFinite(value.minimumWidth) ? Math.round(Math.max(0.1, Math.min(1, value.minimumWidth)) * 10) / 10 : 0.4,
			allowHazards: value.allowHazards === true };
	}
	function lines(route) {
		const features = route?.type === "FeatureCollection" ? route.features : route?.type === "Feature" ? [route] : [];
		const result = [];
		for (const feature of features || []) {
			const geometry = feature.geometry;
			for (const coordinates of geometry?.type === "LineString" ? [geometry.coordinates] : geometry?.type === "MultiLineString" ? geometry.coordinates : []) {
				if (!Array.isArray(coordinates) || coordinates.length < 2 || coordinates.some((p) => !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 179 || Math.abs(p[1]) > 84)) throw new Error("Route contains unsupported coordinates");
				result.push({ coordinates, properties: feature.properties || {} });
			}
		}
		if (!result.length) throw new Error("No route available. Draw or open a route first.");
		return result;
	}
	function signature(route) {
		return JSON.stringify(lines(route).map((line) => [line.coordinates, line.properties.segment_type]));
	}
	function distance(a, b) {
		return Math.hypot((a[0] - b[0]) * 111195 * Math.cos((a[1] + b[1]) * Math.PI / 360), (a[1] - b[1]) * 111195);
	}
	function interpolate(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
	function samples(route, step = 10) {
		const result = [];
		let travelled = 0;
		for (const [part, line] of lines(route).entries()) {
			for (let i = 1; i < line.coordinates.length; i++) {
				const a = line.coordinates[i - 1], b = line.coordinates[i];
				const length = distance(a, b);
				const count = Math.ceil(length / step);
				if (result.length + count > 100000) throw new Error("Route is too large to check in one pass; split it into shorter routes.");
				for (let j = 0; j < count; j++) result.push({ a: interpolate(a, b, j / count), b: interpolate(a, b, (j + 1) / count), point: interpolate(a, b, (j + 0.5) / count), start: travelled + j * length / count, length: length / count, part, properties: line.properties });
				travelled += length;
			}
		}
		if (!result.length) throw new Error("Route has no measurable length");
		return result;
	}
	function areas(route) {
		const cells = new Map();
		// Fixed latitude bands make cells stable across viewport and route changes.
		for (const sample of samples(route, 150)) {
			for (const point of [sample.a, sample.b]) {
				const latStep = 0.009, y = Math.floor(point[1] / latStep);
				const lonStep = latStep / Math.cos((y + 0.5) * latStep * Math.PI / 180);
				const x = Math.floor(point[0] / lonStep);
				cells.set(`${x},${y}`, [(y - 0.15) * latStep, (x - 0.15) * lonStep, (y + 1.15) * latStep, (x + 1.15) * lonStep]);
				if (cells.size > 2000) throw new Error("Route crosses too many areas; split it into shorter routes.");
			}
		}
		return [...cells.values()];
	}
	function projection(point, a, b) {
		const scale = Math.cos(point[1] * Math.PI / 180) * 111195;
		const ax = (a[0] - point[0]) * scale, ay = (a[1] - point[1]) * 111195;
		const dx = (b[0] - a[0]) * scale, dy = (b[1] - a[1]) * 111195;
		const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
		return { distance: Math.hypot(ax + dx * t, ay + dy * t), t };
	}
	function rating(value) {
		const match = String(value || "").match(/^S?([0-5])([+-]?)$/i);
		return match ? Number(match[1]) + (match[2] === "+" ? 0.25 : match[2] === "-" ? -0.25 : 0) : undefined;
	}
	function groupWarnings(warnings, routeSamples) {
		const components = new Map();
		let component = 0, previous;
		for (const sample of routeSamples) {
			if (previous && previous.part !== sample.part && distance(previous.b, sample.a) > 1) component++;
			components.set(sample.part, component);
			previous = sample;
		}
		const result = [], latest = new Map();
		for (const warning of [...warnings].sort((a, b) => a.distance - b.distance)) {
			const key = JSON.stringify([warning.kind, warning.text, components.get(warning.part)]);
			const last = latest.get(key);
			// Compare the end of the affected section, not the warning's start.
			// The tiny tolerance keeps a mathematically exact 50m gap separate.
			if (last && warning.distance - last.end < 50 - 0.000001) {
				for (const sample of routeSamples) if (sample.start >= last.end && sample.start < warning.distance) last.coordinates.push(sample.a, sample.b);
				last.coordinates.push(...warning.coordinates);
				last.end = Math.max(last.end, warning.end);
			}
			else {
				const copy = { ...warning, coordinates: [...warning.coordinates] };
				result.push(copy); latest.set(key, copy);
			}
		}
		return result;
	}
	function widthText(p) {
		return p.widthEstimated ? `Width (${p.widthMetres.toFixed(1)}m)` : `Narrow (${p.widthMetres.toFixed(1)}m) path`;
	}
	function hazardText(p) {
		const labels = [];
		function valueText(value) {
			const text = value.trim().replace(/_/g, " ");
			if (["log", "fallen tree", "tree trunk"].includes(text.toLowerCase())) return "Fallen tree";
			return text.charAt(0).toUpperCase() + text.slice(1);
		}
		for (const note of String(p.label || "").split(" · ")) {
			const match = note.match(/^(obstacle|barrier|overgrown|hazard:forward|hazard:backward|hazard):\s*(.*)$/);
			if (!match) continue;
			for (const raw of match[2].split(";")) {
				const value = raw.trim();
				if (!value || ["no", "none", "false"].includes(value)) continue;
				if (match[1] === "overgrown") labels.push(value === "yes" ? "Overgrown path" : `Overgrown (${value.replace(/_/g, " ")})`);
				else if (match[1] === "hazard") labels.push(`hazard: ${value}`);
				else labels.push(valueText(value));
			}
		}
		if (p.mud && !labels.some((text) => /mud/i.test(text))) labels.push("Muddy surface");
		if (p.vegetation && !labels.some((text) => /vegetation|overgrown/i.test(text))) labels.push("Vegetation");
		if (p.log && !labels.includes("Fallen tree")) labels.push("Fallen tree");
		if (p.narrow && !(p.widthMetres > 0) && !labels.includes("Narrow")) labels.push("Narrow trail — width unknown");
		return [...new Set(labels)].join(" · ") || "Obstacle / hazard";
	}
	function analyse(route, features, options) {
		options = preferences(options);
		const routeSamples = samples(route);
		const unique = new Map(features.map((f) => [f.id || f.properties?.osmId, f]));
		const ways = [...unique.values()].filter((f) => f.geometry?.type === "LineString");
		const origin = routeSamples[0].point;
		const scale = Math.cos(origin[1] * Math.PI / 180) * 111195;
		const cell = (p) => [Math.floor((p[0] - origin[0]) * scale / 50), Math.floor((p[1] - origin[1]) * 111195 / 50)];
		const index = new Map();
		for (const way of ways) {
			for (let i = 1; i < way.geometry.coordinates.length; i++) {
				const a = way.geometry.coordinates[i - 1], b = way.geometry.coordinates[i];
				const count = Math.max(1, Math.ceil(distance(a, b) / 25));
				if (count > 10000) continue;
				const segment = { a, b, way };
				for (let j = 0; j <= count; j++) {
					const [x, y] = cell(interpolate(a, b, j / count)), key = `${x},${y}`;
					if (!index.has(key)) index.set(key, new Set());
					index.get(key).add(segment);
				}
			}
		}
		const matches = routeSamples.map(function (sample) {
			if (sample.properties.segment_type && sample.properties.segment_type !== "Routed") return { sample };
			const [x, y] = cell(sample.point), candidates = new Map(), segments = new Set();
			for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const segment of index.get(`${x + dx},${y + dy}`) || []) segments.add(segment);
			for (const segment of segments) {
				const { a, b, way } = segment, p = way.properties;
				if (["layer", "bridge", "tunnel"].some((key) => sample.properties[key] !== undefined && p[key] !== undefined && String(sample.properties[key]) !== String(p[key]))) continue;
				const rx = (sample.b[0] - sample.a[0]) * scale, ry = (sample.b[1] - sample.a[1]) * 111195;
				const wx = (b[0] - a[0]) * scale, wy = (b[1] - a[1]) * 111195;
				const alignment = Math.abs(rx * wx + ry * wy) / (Math.hypot(rx, ry) * Math.hypot(wx, wy) || 1);
				const d = projection(sample.point, a, b).distance;
				if (alignment < 0.9 || d > 8) continue;
				const score = d + (1 - alignment) * 10;
				if (!candidates.has(p.osmId) || candidates.get(p.osmId).score > score) candidates.set(p.osmId, { way, score });
			}
			const sorted = [...candidates.values()].sort((a, b) => a.score - b.score);
			// A close competing way may be parallel or grade-separated. Keep it unknown.
			if (!sorted.length || sorted[1] && sorted[1].score - sorted[0].score < 3) return { sample };
			return { sample, way: sorted[0].way };
		});
		// Reject isolated proximity matches: require at least 20m of continuous overlap.
		for (let i = 0; i < matches.length;) {
			let end = i + 1;
			while (end < matches.length && matches[end].way?.properties.osmId === matches[i].way?.properties.osmId && matches[end].sample.part === matches[i].sample.part) end++;
			if (matches.slice(i, end).reduce((n, hit) => n + hit.sample.length, 0) < 20) for (let j = i; j < end; j++) matches[j].way = undefined;
			i = end;
		}
		const warnings = [], unknown = { unmatched: 0, rating: 0, width: 0 };
		const groups = new Map();
		function add(kind, text, sample, key, point = sample.point) {
			const groupKey = JSON.stringify([kind, text, key, sample.part]);
			let warning = groups.get(groupKey);
			if (!warning || sample.start - warning.end > 25) {
				warning = { kind, text, part: sample.part, distance: sample.start, point, coordinates: [sample.a, sample.b], end: sample.start + sample.length };
				warnings.push(warning); groups.set(groupKey, warning);
			}
			else { warning.coordinates.push(sample.b); warning.end = sample.start + sample.length; }
		}
		for (const { sample, way } of matches) {
			if (!way) { unknown.unmatched += sample.length; continue; }
			const p = way.properties;
			const level = rating(p.trailRating);
			if (level === undefined) unknown.rating += sample.length;
			else if (level > rating(options.maximumLevel)) add("difficulty", `${p.trailRating} trail exceeds ${options.maximumLevel}`, sample, p.trailRating);
			if (!(p.widthMetres > 0)) unknown.width += sample.length;
			else if (p.widthMetres < options.minimumWidth) add("width", widthText(p), sample, String(p.widthMetres));
			if (!options.allowHazards) {
				if (p.mud || p.vegetation || p.log || p.other || p.narrow && !(p.widthMetres > 0)) add("hazard", hazardText(p), sample, p.osmId);
			}
		}
		for (const feature of unique.values()) {
			if (feature.geometry?.type !== "Point") continue;
			for (const { sample, way } of matches) {
				if (!way || !feature.properties.parentWayIds?.includes(way.properties.osmId)) continue;
				const hit = projection(feature.geometry.coordinates, sample.a, sample.b);
				if (hit.distance > 8) continue;
				const p = feature.properties;
				if (p.widthMetres > 0 && p.widthMetres < options.minimumWidth) add("width", widthText(p), sample, p.osmId, feature.geometry.coordinates);
				if (!options.allowHazards && (p.mud || p.vegetation || p.log || p.other || p.narrow && !(p.widthMetres > 0))) add("hazard", hazardText(p), sample, p.osmId, feature.geometry.coordinates);
			}
		}
		return { warnings: groupWarnings(warnings, routeSamples), unknown, distance: routeSamples.reduce((sum, s) => sum + s.length, 0) };
	}
	async function collect(route, load, { signal, progress = function () {}, checkpoint = {} } = {}) {
		samples(route);
		const boxes = areas(route), routeSignature = signature(route);
		if (checkpoint.signature !== routeSignature) Object.assign(checkpoint, { signature: routeSignature, completed: 0, features: [], cached: 0, downloaded: 0 });
		const features = new Map(checkpoint.features.map((feature) => [feature.id || feature.properties?.osmId, feature]));
		for (let i = checkpoint.completed; i < boxes.length; i++) {
			signal?.throwIfAborted();
			progress({ completed: i, total: boxes.length, features: [...features.values()], cached: checkpoint.cached || 0, downloaded: checkpoint.downloaded || 0 });
			const response = await load(boxes[i]);
			signal?.throwIfAborted();
			if (response?.error) throw Object.assign(new Error(response.error), { features: [...features.values()], completed: i, total: boxes.length, retryMs: response.retryMs, permanent: response.permanent, status: response.status });
			if (response?.data?.type !== "FeatureCollection") throw Object.assign(new Error("Route data response is missing"), { permanent: true });
			for (const feature of response.data.features) {
				const id = feature.id || feature.properties?.osmId, previous = features.get(id);
				features.set(id, previous && feature.geometry.type === "Point" ? { ...feature, properties: { ...feature.properties, parentWayIds: [...new Set([...(previous.properties.parentWayIds || []), ...(feature.properties.parentWayIds || [])])] } } : feature);
			}
			const counter = ["memory", "disk", "cache"].includes(response.data.cacheSource) ? "cached" : "downloaded";
			checkpoint[counter] = (checkpoint[counter] || 0) + 1;
			checkpoint.completed = i + 1;
			checkpoint.features = [...features.values()];
		}
		progress({ completed: boxes.length, total: boxes.length, features: [...features.values()], cached: checkpoint.cached || 0, downloaded: checkpoint.downloaded || 0 });
		return [...features.values()];
	}
	function waitForRetry(milliseconds, signal) {
		return new Promise(function (resolve, reject) {
			signal?.throwIfAborted();
			const timer = setTimeout(function () { signal?.removeEventListener("abort", abort); resolve(); }, milliseconds);
			function abort() { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); }
			signal?.addEventListener("abort", abort, { once: true });
		});
	}
	async function collectWithRetry(route, load, { signal, checkpoint = {}, progress = function () {}, waiting = function () {}, now = Date.now, wait = waitForRetry } = {}) {
		samples(route);
		areas(route);
		let stalledSince, completed = checkpoint.completed || 0;
		while (true) {
			signal?.throwIfAborted();
			try {
				return await collect(route, load, { signal, checkpoint, progress: function (value) {
					if (value.completed > completed) stalledSince = undefined;
					completed = value.completed;
					progress(value);
				} });
			}
			catch (error) {
				signal?.throwIfAborted();
				if (error.permanent || [400, 401, 403, 406].includes(error.status)) throw error;
				stalledSince ??= now();
				const remaining = 10 * 60 * 1000 - (now() - stalledSince);
				if (remaining <= 0) throw error;
				const delay = Math.min(remaining, Math.max(30000, Number.isFinite(error.retryMs) ? error.retryMs : 0));
				waiting({ completed: checkpoint.completed || 0, retryMs: delay, error: error.message });
				await wait(delay, signal);
				signal?.throwIfAborted();
				if (now() - stalledSince >= 10 * 60 * 1000) throw error;
			}
		}
	}
	globalThis.KrbRouteCheck = { SUCCESS, preferences, lines, signature, samples, areas, groupWarnings, analyse, collect, collectWithRetry };
})();
