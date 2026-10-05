// Fresh route-only coverage supersedes the regional snapshot, including empty results.
(function () {
	function inside(point, box) { return point[1] >= box[0] && point[0] >= box[1] && point[1] <= box[2] && point[0] <= box[3]; }
	const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
	function clip(feature, boxes, keepInside, prefix) {
		if (feature.geometry.type === "Point") return boxes.some((b) => inside(feature.geometry.coordinates, b)) === keepInside ? [feature] : [];
		if (feature.geometry.type !== "LineString") return [];
		const coordinates = feature.geometry.coordinates, parts = []; let current = [];
		function append(a, b) {
			const last = current.at(-1);
			if (last && (Math.abs(last[0] - a[0]) > 1e-12 || Math.abs(last[1] - a[1]) > 1e-12)) { parts.push(current); current = []; }
			if (!current.length) current.push(a); current.push(b);
		}
		for (let i = 1; i < coordinates.length; i++) {
			const a = coordinates[i - 1], b = coordinates[i], cuts = new Set([0, 1]);
			for (const box of boxes) {
				for (const [axis, values] of [[0, [box[1], box[3]]], [1, [box[0], box[2]]]]) {
					if (a[axis] === b[axis]) continue;
					for (const edge of values) { const t = (edge - a[axis]) / (b[axis] - a[axis]); if (t > 0 && t < 1) cuts.add(t); }
				}
			}
			const sorted = [...cuts].sort((x, y) => x - y), at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
			for (let j = 1; j < sorted.length; j++) {
				if (boxes.some((box) => inside(at((sorted[j - 1] + sorted[j]) / 2), box)) === keepInside) append(at(sorted[j - 1]), at(sorted[j]));
				else if (current.length) { parts.push(current); current = []; }
			}
		}
		if (current.length) parts.push(current);
		return parts.map((part, i) => ({ ...feature, id: `${feature.id || feature.properties.osmId}/${prefix}/${i}`, geometry: { type: "LineString", coordinates: part } }));
	}
	function create() {
		const store = KrbOsmCache.create({ name: "krb-osm-route-overrides-v1", storage: null, diskBytes: 128 * 1024 * 1024 });
		async function put(bounds, data, time = Date.now()) {
			await store.put({ key: bounds.join(","), time, data, routeComplete: true });
			if (!store.stats().persistent) throw Object.assign(new Error("Fresh route data could not be saved persistently"), { permanent: true });
		}
		async function read(boxes, snapshotAt) {
			const entries = [...(await store.list()).values()].filter((e) => e.time > (Date.parse(snapshotAt) || 0) && boxes.some((b) => overlaps(e.bounds, b))).sort((a, b) => b.time - a.time);
			const found = [];
			for (const entry of entries) { const payload = await store.read(entry.id); if (payload) found.push({ bounds: entry.bounds, time: entry.time, data: payload.data }); }
			return found;
		}
		function apply(data, overrides) {
			if (!overrides.length) return data;
			const boxes = overrides.map((o) => o.bounds), features = data.features.flatMap((f) => clip(f, boxes, false, "base"));
			for (let i = 0; i < overrides.length; i++) {
				const previous = boxes.slice(0, i);
				for (const feature of overrides[i].data.features) {
					const fresh = clip(feature, [boxes[i]], true, `fresh${i}`);
					features.push(...(previous.length ? fresh.flatMap((f) => clip(f, previous, false, `fresh${i}`)) : fresh));
				}
			}
			return { ...data, features, refreshedAt: new Date(Math.max(...overrides.map((o) => o.time))).toISOString() };
		}
		return { put, read, apply, clear: store.clear };
	}
	globalThis.KrbOsmOverrides = { create, clip };
})();
