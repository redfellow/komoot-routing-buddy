// Normalize Komoot custom waypoint references; never write planner state here.
(function () {
	class KomootPoiError extends Error {
		constructor(message) {
			super(message);
			this.name = "KomootPoiError";
		}
	}
	const categories = Object.freeze({ trails: "Danger", gravel: "Checkpoint", technical: "Danger", hills: "Checkpoint", steep: "Steep incline", halfway: "Checkpoint" });
	// Verified against the native customization form and its resulting reference model.
	const categoryIds = Object.freeze({ trails: 5, gravel: 35, technical: 5, hills: 35, steep: 43, halfway: 35 });
	function location(value) {
		if (!value || !Number.isFinite(value.lat) || Math.abs(value.lat) > 90 ||
			!Number.isFinite(value.lng) || Math.abs(value.lng) > 180)
			throw new KomootPoiError("Waypoint location is invalid");
		return [value.lng, value.lat];
	}
	function readPath(path, custom = []) {
		if (!Array.isArray(path) || !Array.isArray(custom)) throw new KomootPoiError("Komoot waypoint data is unavailable");
		return path.map(function (entry) {
			if (!entry || typeof entry !== "object") throw new KomootPoiError("Invalid Komoot waypoint entry");
			const match = typeof entry.reference === "string" ? /^cnw:([1-9]\d*)$/.exec(entry.reference) : null,
				id = match ? Number(match[1]) : undefined,
				metadata = id ? custom[id - 1] : undefined;
			return {
				index: entry.index,
				point: entry.location ? location(entry.location) : undefined,
				reference: entry.reference,
				customId: id,
				name: match ? entry.name ?? metadata?.name : entry.name,
				category: match ? entry.category ?? metadata?.category : entry.category,
				description: match ? entry.description ?? metadata?.description : entry.description,
			};
		});
	}
	function readCoordinates(items) {
		if (!Array.isArray(items) || items.length < 2 || items.length > 250000)
			throw new KomootPoiError("Komoot route coordinates are unavailable");
		const result = [];
		let distance = 0;
		for (const [index, item] of items.entries()) {
			const point = location(item);
			if (index > 0) {
				const previous = items[index - 1],
					radians = Math.PI / 180,
					latitude = (item.lat - previous.lat) * radians,
					longitude = (item.lng - previous.lng) * radians,
					value = Math.sin(latitude / 2) ** 2 + Math.cos(previous.lat * radians) *
						Math.cos(item.lat * radians) * Math.sin(longitude / 2) ** 2,
					length = 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, value)));
				if (length === 0) continue;
				distance += length;
			}
			result.push({ index, distance, point, elevation: Number.isFinite(item.alt) ? item.alt : undefined });
		}
		if (result.length < 2) throw new KomootPoiError("Komoot route has no travelled distance");
		return result;
	}
	function approved(pois) {
		if (!Array.isArray(pois) || !pois.length || pois.length > 100)
			throw new KomootPoiError("Select between 1 and 100 route POIs");
		const seen = new Set();
		return pois.map(function (poi) {
			if (!poi || typeof poi.name !== "string" || !poi.name.trim() || Array.from(poi.name).length > 16 ||
				!Object.hasOwn(categories, poi.kind) || typeof poi.id !== "string" || seen.has(poi.id) ||
				!Number.isFinite(poi.distance) || poi.distance < 0 || !Array.isArray(poi.point))
				throw new KomootPoiError("Approved POI has invalid name, category, identity or position");
			const point = location({ lng: poi.point[0], lat: poi.point[1] });
			seen.add(poi.id);
			if (poi.geometryDistance !== undefined && (!Number.isFinite(poi.geometryDistance) || poi.geometryDistance < 0))
				throw new KomootPoiError("Approved POI has invalid geometry distance");
			return { id: poi.id, name: poi.name, kind: poi.kind, point, distance: poi.distance, geometryDistance: poi.geometryDistance,
				categoryLabel: categories[poi.kind], category: categoryIds[poi.kind] };
		}).sort((a, b) => a.distance - b.distance);
	}
	globalThis.KrbKomootPoiData = { readPath, readCoordinates, approved, categories, categoryIds, KomootPoiError };
})();
