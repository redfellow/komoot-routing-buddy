// Runs in the page world. Komoot owns recalculation and the user owns saving the route.
(function () {
	class PoiInsertionError extends Error {
		constructor(message) {
			super(message);
			this.name = "PoiInsertionError";
		}
	}
	const categories = Object.freeze({ trails: 5, gravel: 35, technical: 5, hills: 35, steep: 43, halfway: 35 });
	function distance(a, b) {
		const radians = Math.PI / 180,
			value = Math.sin((b.lat - a.lat) * radians / 2) ** 2 +
				Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin((b.lng - a.lng) * radians / 2) ** 2;
		return 12742000 * Math.asin(Math.sqrt(Math.min(1, value)));
	}
	function coordinates(tour) {
		const items = tour.link("coordinates")?.get("items");
		if (!Array.isArray(items) || items.length < 2 || items.length > 250000 ||
			items.some((point) => !Number.isFinite(point.lat) || Math.abs(point.lat) > 90 || !Number.isFinite(point.lng) || Math.abs(point.lng) > 180))
			throw new PoiInsertionError("Komoot route coordinates are unavailable.");
		return items;
	}
	function position(items, metres) {
		let travelled = 0;
		for (let index = 1; index < items.length; index++) {
			const a = items[index - 1], b = items[index], length = distance(a, b);
			if (length > 0 && metres <= travelled + length + 0.001) {
				const fraction = Math.max(0, Math.min(1, (metres - travelled) / length));
				return { index: index - 1 + fraction, location: { lat: a.lat + (b.lat - a.lat) * fraction, lng: a.lng + (b.lng - a.lng) * fraction } };
			}
			travelled += length;
		}
		throw new PoiInsertionError("POI is beyond the end of the current route.");
	}
	function shape(items) {
		const result = [];
		for (const point of items) {
			if (result.length && distance(result.at(-1), point) < 0.001) continue;
			while (result.length > 1) {
				const a = result.at(-2), b = result.at(-1),
					xScale = Math.cos(a.lat * Math.PI / 180),
					x = (point.lng - a.lng) * xScale, y = point.lat - a.lat,
					bx = (b.lng - a.lng) * xScale, by = b.lat - a.lat,
					squared = x * x + y * y,
					t = squared ? (bx * x + by * y) / squared : -1,
					deviation = squared ? Math.abs(bx * y - by * x) / Math.sqrt(squared) * 111195 : Infinity;
				// Komoot returns six-decimal coordinates: inserted vertices can round by several centimetres.
				if (t < 0 || t > 1 || deviation > 0.1) break;
				result.pop();
			}
			result.push(point);
		}
		return result;
	}
	function sameGeometry(before, after) {
		const a = shape(before), b = shape(after);
		return a.length === b.length && a.every((point, index) => distance(point, b[index]) < 0.1);
	}
	function supported(tour) {
		return Boolean(tour && ["wpAdd", "fetchByWaypoints", "set", "toJSON", "link"].every((key) => typeof tour[key] === "function"));
	}
	function references(tour) {
		return tour.link("way_points").models.map(function (waypoint) {
			return { index: waypoint.get("index"), reference: waypoint.link("reference") };
		});
	}
	function existingPois(tour) {
		const items = coordinates(tour), cumulative = [0];
		for (let index = 1; index < items.length; index++) cumulative.push(cumulative.at(-1) + distance(items[index - 1], items[index]));
		return references(tour).filter((entry) => typeof entry.reference.get("cnwName") === "string" && Number.isFinite(entry.index) && entry.index >= 0 && entry.index <= items.length - 1).map(function (entry) {
			const index = Math.floor(entry.index), next = Math.min(index + 1, items.length - 1), location = entry.reference.get("location");
			return { name: entry.reference.get("cnwName"), category: entry.reference.get("cnwCategory"),
				point: location ? [location.lng, location.lat] : undefined,
				geometryDistance: cumulative[index] + (cumulative[next] - cumulative[index]) * (entry.index - index) };
		});
	}

	function referenceState(tour) {
		return references(tour).map(function (entry) {
			const reference = entry.reference,
				custom = reference.get("cnwId") != null,
				state = Object.fromEntries(["type", "id", "location", "name", "cnwId", "cnwName", "cnwCategory", "cnwDescription"]
					.map((key) => [key, reference.get(key)]));
			// Hydrating a saved Highlight converts its numeric ID to a string.
			// Compare the identity consistently without relaxing other waypoint checks.
			if (typeof state.id === "number" || typeof state.id === "string") state.id = String(state.id);
			// Komoot rebuilds cnw references from the routing response with cnwName,
			// omitting the redundant plain name and sometimes an empty description.
			if (custom) {
				state.cnwName = state.cnwName ?? state.name;
				delete state.name;
				state.cnwDescription = state.cnwDescription ?? "";
			}
			return JSON.stringify(state);
		});
	}
	const generatedPrefix = "KRB generated POI v1:";
	function geometryKey(items) {
		let hash = 2166136261;
		const value = JSON.stringify(items.map((point) => [point.lat, point.lng]));
		for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
		return `${items.length}:${hash >>> 0}`;
	}
	function generated(reference) {
		const description = reference.get("cnwDescription");
		if (typeof description !== "string" || !description.startsWith(generatedPrefix)) return;
		try {
			const value = JSON.parse(description.slice(generatedPrefix.length));
			if (value && typeof value.geometry === "string" && typeof value.name === "string" &&
				value.name === reference.get("cnwName") && value.category === reference.get("cnwCategory")) return value;
		}
		catch (error) {
			console.debug("Invalid generated POI metadata:", error.message);
		}
	}
	function clearStale(tour) {
		if (!supported(tour)) return 0;
		const owned = references(tour).map((entry) => ({ reference: entry.reference, marker: generated(entry.reference) })).filter((entry) => entry.marker);
		if (!owned.length) return 0;
		const key = geometryKey(coordinates(tour));
		let cleared = 0;
		for (const { reference, marker } of owned) {
			if (!marker || marker.geometry === key || typeof reference.set !== "function") continue;
			reference.set({ cnwId: null, cnwName: null, cnwCategory: null, cnwDescription: null, name: marker.originalName ?? null }, { silent: true });
			cleared++;
		}
		if (cleared) {
			const waypoints = tour.link("way_points");
			waypoints.trigger("change:path", waypoints, { action: "waypoint_customize" });
		}
		return cleared;
	}

	async function insert(tour, pois, control) {
		if (!supported(tour) || !Array.isArray(pois) || !pois.length || pois.length > 100)
			throw new PoiInsertionError("Komoot POI insertion is unavailable.");
		const original = JSON.parse(JSON.stringify(tour.toJSON(""))),
			before = JSON.parse(JSON.stringify(coordinates(tour))),
			existing = references(tour),
			known = existingPois(tour),
			originalReferences = referenceState(tour),
			ids = new Set(existing.map((entry) => entry.reference.get("cnwId")).filter(Number.isInteger)),
			seen = new Set(),
			plans = [];
		let skipped = 0;
		for (const poi of [...pois].sort((a, b) => a.distance - b.distance)) {
			if (!poi || typeof poi.id !== "string" || seen.has(poi.id) || !Object.hasOwn(categories, poi.kind) ||
				typeof poi.name !== "string" || !poi.name.trim() || Array.from(poi.name).length > 16 ||
				!Number.isFinite(poi.distance) || poi.distance < 0 || !Array.isArray(poi.point) || poi.point.length !== 2 ||
				!poi.point.every(Number.isFinite)) throw new PoiInsertionError("Invalid approved POI.");
			seen.add(poi.id);
			const placement = position(before, poi.geometryDistance ?? poi.distance);
			if (distance(placement.location, { lng: poi.point[0], lat: poi.point[1] }) > 1)
				throw new PoiInsertionError("Approved POI no longer matches the route.");
			if (known.some((entry) => entry.name.trim().toLowerCase() === poi.name.trim().toLowerCase() &&
				Math.abs(entry.geometryDistance - (poi.geometryDistance ?? poi.distance)) < 10 && entry.point &&
				distance({ lng: entry.point[0], lat: entry.point[1] }, placement.location) < 10) ||
				plans.some((entry) => entry.poi.name.trim().toLowerCase() === poi.name.trim().toLowerCase() &&
					Math.abs((entry.poi.geometryDistance ?? entry.poi.distance) - (poi.geometryDistance ?? poi.distance)) < 10)) {
				skipped++;
				continue;
			}
			let id = 1;
			while (ids.has(id) && id <= 512) id++;
			if (id > 512) throw new PoiInsertionError("Komoot has no unused custom POI identifiers.");
			ids.add(id);
			plans.push({ poi, placement, id });
		}
		if (control.cancelled() || !control.isCurrent()) return { added: 0, skipped, cancelled: true };
		if (!plans.length) return { added: 0, skipped, cancelled: false };
		const cumulative = [0];
		for (let index = 1; index < before.length; index++) cumulative.push(cumulative.at(-1) + distance(before[index - 1], before[index]));
		let mutated = false;
		try {
			for (const plan of plans) {
				if (control.cancelled()) throw new PoiInsertionError("POI insertion cancelled.");
				const current = references(tour),
					coincident = current.filter(function (entry) {
						const reference = entry.reference, location = reference.get("location"), index = Math.floor(entry.index);
						if (!Number.isFinite(entry.index) || entry.index < 0 || entry.index > before.length - 1 || !location ||
							reference.get("type") !== "point" || reference.get("cnwId") || typeof reference.set !== "function") return false;
						const progress = cumulative[index] + (cumulative[Math.min(index + 1, before.length - 1)] - cumulative[index]) * (entry.index - index);
						return Math.abs(progress - (plan.poi.geometryDistance ?? plan.poi.distance)) <= 100 &&
							distance(location, plan.placement.location) <= 100;
					}).sort((a, b) => distance(a.reference.get("location"), plan.placement.location) - distance(b.reference.get("location"), plan.placement.location))[0],
					marker = { geometry: geometryKey(before), name: plan.poi.name, category: categories[plan.poi.kind], originalName: coincident?.reference.get("name") ?? null },
					metadata = { cnwId: plan.id, cnwName: plan.poi.name, cnwCategory: categories[plan.poi.kind], cnwDescription: generatedPrefix + JSON.stringify(marker) };
				if (coincident && typeof coincident.reference.set === "function") {
					// Reuse nearby ordinary waypoints without moving them. The progress
					// check keeps separate visits to the same location on loops distinct.
					const originalIndex = originalReferences.indexOf(referenceState(tour)[current.indexOf(coincident)]);
					if (originalIndex < 0) throw new PoiInsertionError("The existing waypoint could not be verified.");
					mutated = true;
					coincident.reference.set(metadata, { silent: true });
					plan.customizedReference = originalReferences[originalIndex];
					plan.expectedReference = referenceState(tour)[current.indexOf(coincident)];
					continue;
				}
				const at = current.findIndex((entry) => entry.index > plan.placement.index);
				if (at < 1) throw new PoiInsertionError("Komoot cannot insert this POI between existing waypoints.");
				mutated = true;
				await tour.wpAdd({ type: "point", index: plan.placement.index, location: plan.placement.location,
					...metadata }, { at, silent: true });
			}
			await tour.fetchByWaypoints(null, {});
			if (control.cancelled()) throw new PoiInsertionError("POI insertion cancelled.");
			if (!sameGeometry(before, coordinates(tour))) throw new PoiInsertionError("Komoot changed the route while adding POIs.");
			const actual = references(tour);
			const remaining = referenceState(tour);
			const customized = plans.filter((plan) => plan.customizedReference !== undefined);
			for (const reference of originalReferences) {
				const planIndex = customized.findIndex((plan) => plan.customizedReference === reference),
					expected = planIndex >= 0 ? customized.splice(planIndex, 1)[0].expectedReference : reference,
					index = remaining.indexOf(expected);
				if (index < 0) throw new PoiInsertionError("Komoot changed an existing route waypoint.");
				remaining.splice(index, 1);
			}
			for (const plan of plans) {
				const reference = actual.find((entry) => entry.reference.get("cnwId") === plan.id)?.reference;
				if (!reference || reference.get("cnwName") !== plan.poi.name || reference.get("cnwCategory") !== categories[plan.poi.kind])
					throw new PoiInsertionError("Komoot did not retain an approved POI's name or icon.");
			}
			// Recalculation can insert coordinate vertices without changing the route.
			// Refresh all owned markers only after the geometry checks have passed.
			const key = geometryKey(coordinates(tour));
			for (const entry of actual) {
				const marker = generated(entry.reference);
				if (marker) entry.reference.set({ cnwDescription: generatedPrefix + JSON.stringify({ ...marker, geometry: key }) }, { silent: true });
			}
			const waypoints = tour.link("way_points");
			waypoints.trigger("change:path", waypoints, { action: "waypoint_add_by_api" });
			return { added: plans.length, skipped, cancelled: false };
		}
		catch (error) {
			if (mutated) {
				tour.set(original, { silent: true });
				const waypoints = tour.link("way_points");
				waypoints.trigger("change:path", waypoints, { action: "restore_history" });
				if (!sameGeometry(before, coordinates(tour)) || JSON.stringify(referenceState(tour)) !== JSON.stringify(originalReferences))
					throw new PoiInsertionError("POI insertion failed and route restoration could not be verified. Use Komoot Undo before saving.");
			}
			throw new PoiInsertionError(`${error.message} The original route was restored.`);
		}
	}
	globalThis.KrbKomootPoiInsert = { insert, supported, sameGeometry, existingPois, clearStale, PoiInsertionError };
})();
