// Pure ride analysis. Input points carry cumulative metres and optional verified elevation/character.
(function () {
	class RideOverviewError extends Error {
		constructor(message) {
			super(message);
			this.name = "RideOverviewError";
		}
	}
	// Verified against Komoot's native way-type captions; d3 and d4 both display S2.
	const NATIVE_MTB_GRADES = Object.freeze({ "wt#trail_d1": 0, "wt#trail_d2": 1, "wt#trail_d3": 2, "wt#trail_d4": 2, "wt#trail_d5": 3, "wt#trail_d6": 4, "wt#trail_d7": 5 });
	const DEFAULTS = Object.freeze({
		hillWindow: 5000,
		hillAscent: 150,
		steepLength: 300,
		steepGradient: 8,
		trailLength: 500,
		gravelLength: 2000,
		technicalLength: 500,
		trailGap: 150,
		smoothingDistance: 100,
	});
	function preferences(value = {}) {
		const result = { ...DEFAULTS };
		for (const key of Object.keys(DEFAULTS)) {
			if (typeof DEFAULTS[key] === "boolean") result[key] = typeof value[key] === "boolean" ? value[key] : DEFAULTS[key];
			else if (Number.isFinite(value[key]) && (value[key] > 0 || (key === "trailGap" && value[key] === 0))) result[key] = value[key];
		}
		return result;
	}
	function validate(points) {
		if (!Array.isArray(points) || points.length < 2 || points.length > 250000)
			throw new RideOverviewError("Ride overview needs a bounded route profile");
		for (const [index, item] of points.entries()) {
			if (!Number.isFinite(item.distance) || item.distance < 0 ||
				(index === 0 && item.distance !== 0) ||
				(index > 0 && item.distance <= points[index - 1].distance) ||
				!Array.isArray(item.point) || item.point.length < 2 ||
				!Number.isFinite(item.point[0]) || Math.abs(item.point[0]) > 180 ||
				!Number.isFinite(item.point[1]) || Math.abs(item.point[1]) > 90)
				throw new RideOverviewError("Invalid or unordered route profile");
		}
	}
	function atDistance(points, distance) {
		let low = 0,
			high = points.length - 1;
		while (low + 1 < high) {
			const middle = Math.floor((low + high) / 2);
			if (points[middle].distance <= distance) low = middle;
			else high = middle;
		}
		const a = points[low],
			b = points[high],
			t = Math.max(0, Math.min(1, (distance - a.distance) / (b.distance - a.distance)));
		return {
			distance,
			geometryDistance: Number.isFinite(a.geometryDistance) && Number.isFinite(b.geometryDistance)
				? a.geometryDistance + (b.geometryDistance - a.geometryDistance) * t : undefined,
			point: [a.point[0] + ((a.endPoint || b.point)[0] - a.point[0]) * t, a.point[1] + ((a.endPoint || b.point)[1] - a.point[1]) * t],
			elevation: !a.breakAfter && Number.isFinite(a.elevation) && Number.isFinite(b.elevation)
				? a.elevation + (b.elevation - a.elevation) * t : undefined,
		};
	}
	function sectionCoordinates(points, start, end) {
		validate(points);
		if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > points.at(-1).distance || end <= start)
			throw new RideOverviewError("Invalid section to highlight");
		const coordinates = [atDistance(points, start).point];
		for (const point of points) {
			if (point.distance >= start && point.distance < end && point.breakAfter)
				throw new RideOverviewError("Cannot highlight across disconnected route parts");
			if (point.distance > start && point.distance < end && point.vertex !== false) coordinates.push(point.point);
		}
		coordinates.push(atDistance(points, end).point);
		if (coordinates.length > 100000) throw new RideOverviewError("Section is too large to highlight");
		return coordinates;
	}
	function smooth(points, radius) {
		return points.map(function (item) {
			if (!Number.isFinite(item.elevation)) return undefined;
			const a = atDistance(points, Math.max(0, item.distance - radius / 2)),
				b = atDistance(points, Math.min(points.at(-1).distance, item.distance + radius / 2));
			return !a.breakAfter && Number.isFinite(a.elevation) && Number.isFinite(b.elevation)
				? (a.elevation + item.elevation + b.elevation) / 3 : undefined;
		});
	}
	function fromRoute(route, features = [], coordinates) {
		const checker = globalThis.KrbRouteCheck;
		if (!checker) throw new RideOverviewError("Route matching is unavailable");
		const { matches } = checker.matchRoute(route, features);
		const points = matches.map(function ({ sample, way }) {
			const properties = way?.properties;
			let character = "unknown";
			if (properties) {
				const surface = checker.trailSurface(properties);
				if (surface === "unpaved") character = properties.highway === "track" ? "track" : "trail";
				else if (["paved", "asphalt", "concrete", "paving_stones"].includes(properties.surface)) character = "paved";
			}
			return { distance: sample.start, point: sample.a, endPoint: sample.b, character, part: sample.part };
		});
		const last = matches.at(-1).sample;
		points.push({ distance: last.start + last.length, point: last.b, character: "unknown", part: last.part });
		for (let index = 0; index < points.length - 1; index++) {
			const end = points[index].endPoint,
				next = points[index + 1];
			points[index].breakAfter = points[index].part !== next.part &&
				(Math.abs(end[0] - next.point[0]) > 0.000001 || Math.abs(end[1] - next.point[1]) > 0.000001);
		}
		validate(points);
		if (coordinates) {
			const profile = globalThis.KrbKomootPoiData.readCoordinates(coordinates);
			if (Math.abs(profile.at(-1).distance - points.at(-1).distance) > 1)
				throw new RideOverviewError("Komoot elevation profile does not match the route distance");
			for (const point of points) point.elevation = atDistance(profile, point.distance).elevation;
		}
		return points;
	}
	function fromKomoot(data, features = []) {
		const profile = globalThis.KrbKomootPoiData.readCoordinates(data?.coordinates),
			geometryLength = profile.at(-1).distance,
			factor = Number.isFinite(data.distance) && data.distance > 0 ? data.distance / geometryLength : 1,
			points = [],
			matches = features.length && globalThis.KrbRouteCheck ? globalThis.KrbRouteCheck.matchRoute({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: profile.map((point) => point.point) } }, features).matches : [];
		let matchIndex = 0;
		function gradeAt(distance) {
			while (matchIndex < matches.length && matches[matchIndex].sample.start + matches[matchIndex].sample.length <= distance) matchIndex++;
			const match = matches[matchIndex];
			if (!match || distance < match.sample.start) return undefined;
			const rating = match.way?.properties?.trailRating;
			return typeof rating === "string" && /^S[0-5]$/.test(rating) ? Number(rating.slice(1)) : undefined;
		}
		function characterFor(surfaceGroup, wayType, grade) {
			if (surfaceGroup === "paved") return "paved";
			if (grade >= 1) return "technical";
			if (grade === 0 || wayType === "wt#trail") return "trail";
			return surfaceGroup === "unpaved" ? "gravel" : "unknown";
		}
		function category(ranges, index) {
			if (!Array.isArray(ranges)) return "unknown";
			const matches = ranges.filter((range) => Number.isInteger(range.from) && Number.isInteger(range.to) &&
				range.from <= index && index < range.to && typeof range.element === "string");
			return matches.length === 1 ? matches[0].element : "unknown";
		}
		for (let index = 0; index < profile.length - 1; index++) {
			const a = profile[index], b = profile[index + 1],
				surface = category(data.surfaces, a.index), wayType = category(data.wayTypes, a.index),
				paved = ["sb#asphalt", "sb#paved", "sb#paving_stones", "sb#cobbles", "sb#concrete"].includes(surface),
				unpaved = ["sb#compacted", "sb#unpaved", "sb#ground", "sb#gravel", "sb#sand", "sb#dirt", "sb#mud", "sb#grass"].includes(surface),
				nativeGrade = Object.hasOwn(NATIVE_MTB_GRADES, wayType) ? NATIVE_MTB_GRADES[wayType] : undefined,
				mtbEligible = wayType === "wt#way" || wayType.startsWith("wt#trail") || wayType.startsWith("wt#track"),
				surfaceGroup = paved ? "paved" : unpaved ? "unpaved" : "unknown",
				count = Math.ceil((b.distance - a.distance) * factor / 10);
			if (points.length + count > 250000) throw new RideOverviewError("Komoot route is too long to analyse");
			for (let sample = 0; sample < count; sample++) {
				const t = sample / count, next = (sample + 1) / count,
					geometryDistance = a.distance + (b.distance - a.distance) * t,
					mtbGrade = nativeGrade ?? (mtbEligible ? gradeAt(geometryDistance) : undefined),
					character = characterFor(surfaceGroup, wayType, mtbGrade);
				points.push({ distance: (a.distance + (b.distance - a.distance) * t) * factor,
					geometryDistance: a.distance + (b.distance - a.distance) * t,
					point: [a.point[0] + (b.point[0] - a.point[0]) * t, a.point[1] + (b.point[1] - a.point[1]) * t],
					endPoint: [a.point[0] + (b.point[0] - a.point[0]) * next, a.point[1] + (b.point[1] - a.point[1]) * next],
					elevation: Number.isFinite(a.elevation) && Number.isFinite(b.elevation) ? a.elevation + (b.elevation - a.elevation) * t : undefined,
					vertex: sample === 0, character, surface, wayType, surfaceGroup, mtbGrade, mtbEligible: mtbEligible && !paved, mtbSource: Number.isFinite(nativeGrade) ? "Komoot" : Number.isFinite(mtbGrade) ? "OSM" : undefined, part: 0 });
			}
		}
		const last = profile.at(-1);
		points.push({ distance: last.distance * factor, geometryDistance: last.distance, point: last.point, elevation: last.elevation, part: 0 });
		validate(points);
		if (Number.isFinite(data.ascent) && data.ascent >= 0) points[0].nativeAscent = data.ascent;
		return points;
	}
	function analyse(points, value = {}) {
		validate(points);
		const options = preferences(value),
			totalDistance = points.at(-1).distance,
			elevations = smooth(points, options.smoothingDistance),
			sections = [],
			characterSections = [],
			missingMtbSections = [],
			pois = [],
			totals = { trail: 0, technical: 0, gravel: 0, track: 0, paved: 0, unpaved: 0, unknown: 0 },
			surfaceTotals = { paved: 0, unpaved: 0, unknown: 0 }, surfaceDetailTotals = {}, wayTypeTotals = {};
		function add(kind, name, start, end, details = {}) {
			const reason = { trails: "Start of sustained trail riding", gravel: "Start of sustained gravel or dirt riding", technical: "Start of sustained S1–S5 riding", hills: "Start of concentrated climbing", steep: "Start of a sustained steep climb" }[kind];
			sections.push({ kind, start, end, reason, ...details });
			pois.push({ id: `${kind}:${start.toFixed(1)}`, kind, name, ...atDistance(points, start), end, reason, ...details });
		}
		let missingMtbDistance = 0,
			ascent = 0,
			elevationDistance = 0;
		const gains = [0],
			known = [0],
			breaks = [0];
		for (let index = 1; index < points.length; index++) {
			const length = points[index].distance - points[index - 1].distance,
				character = Object.hasOwn(totals, points[index - 1].character) ? points[index - 1].character : "unknown",
				validElevation = !points[index - 1].breakAfter && Number.isFinite(elevations[index - 1]) && Number.isFinite(elevations[index]),
				delta = validElevation ? elevations[index] - elevations[index - 1] : 0;
			totals[character] += length;
			if (points[index - 1].mtbEligible && !Number.isFinite(points[index - 1].mtbGrade)) {
				missingMtbDistance += length;
				const previous = missingMtbSections.at(-1);
				if (previous && previous.end === points[index - 1].distance && !points[index - 2]?.breakAfter)
					previous.end = points[index].distance;
				else missingMtbSections.push({ start: points[index - 1].distance, end: points[index].distance });
			}
			const surfaceGroup = points[index - 1].surfaceGroup;
			if (Object.hasOwn(surfaceTotals, surfaceGroup)) surfaceTotals[surfaceGroup] += length;
			const surface = points[index - 1].surface || "unknown";
			surfaceDetailTotals[surface] = (surfaceDetailTotals[surface] || 0) + length;
			const wayType = points[index - 1].wayType;
			if (wayType) wayTypeTotals[wayType] = (wayTypeTotals[wayType] || 0) + length;
			const previous = characterSections.at(-1);
			if (previous?.character === character && previous.part === points[index - 1].part && previous.surfaceGroup === surfaceGroup && previous.wayType === wayType) previous.end = points[index].distance;
			else characterSections.push({ character, surfaceGroup, wayType, part: points[index - 1].part, start: points[index - 1].distance, end: points[index].distance });
			ascent += Math.max(0, delta);
			if (validElevation) elevationDistance += length;
			gains.push(ascent);
			known.push(elevationDistance);
			breaks.push(breaks.at(-1) + (points[index - 1].breakAfter ? 1 : 0));
		}
		function cumulative(values, distance) {
			let low = 0,
				high = points.length - 1;
			while (low + 1 < high) {
				const middle = Math.floor((low + high) / 2);
				if (points[middle].distance <= distance) low = middle;
				else high = middle;
			}
			const t = (distance - points[low].distance) / (points[high].distance - points[low].distance);
			return values[low] + (values[high] - values[low]) * t;
		}
		function windows(kind, name, window, qualifies) {
			let section;
			function finish() {
				if (!section) return;
				const details = kind === "hills"
					? { ascent: cumulative(gains, section.end) - cumulative(gains, section.start) }
					: { gradient: (cumulative(elevations, section.end) - cumulative(elevations, section.start)) / (section.end - section.start) * 100, peakGradient: section.details.gradient };
				add(kind, name, section.start, section.end, details);
				section = undefined;
			}
			for (let index = 1; index < points.length; index++) {
				const end = points[index].distance,
					start = Math.max(0, end - window),
					details = qualifies(start, end, index);
				if (!details || breaks[index] - cumulative(breaks, start) > 0) continue;
				if (section && start > section.end) finish();
				if (!section) {
					let beginning = start;
					if (kind === "hills") {
						const baseline = cumulative(gains, start);
						let low = 0, high = index;
						while (low + 1 < high) {
							const middle = Math.floor((low + high) / 2);
							if (gains[middle] <= baseline + 0.001) low = middle;
							else high = middle;
						}
						beginning = Math.max(start, points[high - 1].distance);
					}
					section = { start: beginning, end, details };
				}
				else {
					section.end = end;
					if (details.gradient > section.details.gradient) section.details = details;
				}
			}
			finish();
		}
		function characterSectionsFor(kind, name, character, minimum) {
			let section;
			function finish() {
				if (section && section.characterDistance + 0.000001 >= minimum)
					add(kind, name, section.start, section.end, { characterDistance: section.characterDistance, share: section.characterDistance / (section.end - section.start), ...(kind === "trails" ? { trailDistance: section.characterDistance } : {}) });
				section = undefined;
			}
			for (let index = 0; index < points.length - 1; index++) {
				const point = points[index], end = points[index + 1].distance;
				if (point.character !== character) {
					if (point.breakAfter) finish();
					continue;
				}
				if (section && point.distance - section.end > options.trailGap + 0.000001) finish();
				if (!section) section = { start: point.distance, end, characterDistance: 0 };
				section.end = end;
				section.characterDistance += end - point.distance;
				if (point.breakAfter) finish();
			}
			finish();
		}
		characterSectionsFor("trails", "Trails", "trail", options.trailLength);
		characterSectionsFor("gravel", "Gravel", "gravel", options.gravelLength);
		characterSectionsFor("technical", "Technical", "technical", options.technicalLength);
		windows("hills", "Hills", options.hillWindow, function (start, end, index) {
			const length = end - start,
				gain = gains[index] - cumulative(gains, start),
				coverage = known[index] - cumulative(known, start);
			return length > 0 && gain >= options.hillAscent && coverage >= length - 0.01
				? { ascent: gain } : undefined;
		});
		windows("steep", "Steep climb", options.steepLength, function (start, end, index) {
			const length = end - start,
				coverage = known[index] - cumulative(known, start),
				gradient = (elevations[index] - cumulative(elevations, start)) / length * 100;
			return length >= options.steepLength && coverage >= length - 0.01 && gradient >= options.steepGradient
				? { gradient } : undefined;
		});
		// Keep both findings in the overview; the more specific climb owns a nearby POI.
		for (let index = pois.length - 1; index >= 0; index--) {
			const poi = pois[index];
			if (poi.kind !== "hills") continue;
			const steep = pois.find((candidate) => candidate.kind === "steep" && Math.abs(candidate.distance - poi.distance) <= 150);
			if (!steep) continue;
			steep.relatedKinds = ["hills"];
			steep.reason = "Steep climb within a section of concentrated climbing";
			pois.splice(index, 1);
		}
		let climbingFinish;
		if (elevationDistance / totalDistance >= 1 - 1e-9 && ascent >= options.hillAscent) {
			const index = gains.findIndex((gain) => gain >= ascent * 0.95);
			climbingFinish = points[index].distance;
		}
		for (const section of sections) {
			const other = new Set();
			if (Number.isFinite(section.share) && section.share < 0.999) {
				const character = { trails: "trail", technical: "technical", gravel: "gravel" }[section.kind];
				for (const segment of characterSections) {
					if (segment.start < section.end && segment.end > section.start && segment.character !== character) other.add(segment.character);
				}
			}
			section.otherCharacters = [...other];
			const poi = pois.find((candidate) => candidate.kind === section.kind && candidate.distance === section.start);
			if (poi) poi.otherCharacters = section.otherCharacters;
		}
		pois.push({ id: "halfway", kind: "halfway", name: "Halfway", reason: "Half the ride distance completed", ...atDistance(points, totalDistance / 2) });
		sections.sort((a, b) => a.start - b.start);
		pois.sort((a, b) => a.distance - b.distance);
		return { totalDistance, totals, ascent: Number.isFinite(points[0].nativeAscent) ? points[0].nativeAscent : ascent,
			ascentAvailable: Number.isFinite(points[0].nativeAscent) || elevationDistance > 0, ascentSource: Number.isFinite(points[0].nativeAscent) ? "Komoot" : "profile",
			elevationCoverage: elevationDistance / totalDistance, missingMtbDistance, missingMtbSections, climbingFinish, characterSections, sections, pois, surfaceTotals, surfaceDetailTotals, wayTypeTotals };
	}
	function wayLabel(value) {
		return { "wt#street": "Roads", "wt#minor_road": "Streets", "wt#cycleway": "Cycleways", "wt#way": "Paths", "wt#major_road": "State roads" }[value] ||
			(value?.startsWith("wt#trail") ? "Singletrack" : value?.startsWith("wt#track") ? "Doubletracks" : "Unknown");
	}
	function breakdown(totals = {}, kind) {
		const groups = {};
		for (const [key, distance] of Object.entries(totals)) {
			const label = kind === "way" ? wayLabel(key) : {
				"sb#asphalt": "Asphalt", "sb#paved": "Paved", "sb#paving_stones": "Paving stones", "sb#cobbles": "Cobblestones", "sb#concrete": "Concrete",
				"sb#compacted": "Compacted gravel", "sb#unpaved": "Unpaved", "sb#ground": "Ground", "sb#gravel": "Gravel", "sb#sand": "Sand", "sb#dirt": "Dirt", "sb#mud": "Mud", "sb#grass": "Grass",
			}[key] || "Unknown";
			if (Number.isFinite(distance) && distance > 0) groups[label] = (groups[label] || 0) + distance;
		}
		return Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([label, distance]) => ({ label, distance }));
	}
	function sectionDetail(section) {
		const labels = { trail: "trail", technical: "technical trail", gravel: "gravel", paved: "paved", unknown: "unmapped" };
		if (Number.isFinite(section.characterDistance)) {
			const label = { trails: "trail riding", gravel: "gravel or dirt", technical: "S1–S5 riding" }[section.kind];
			const mixed = section.otherCharacters?.length ? `, with short ${section.otherCharacters.map((character) => labels[character] || character).join(" / ")} stretches` : "";
			return `${(section.characterDistance / 1000).toFixed(1)} km of ${label}${mixed}`;
		}
		if (Number.isFinite(section.ascent)) return `${Math.round(section.ascent)} m of climbing in this section`;
		if (Number.isFinite(section.gradient)) return `${(section.peakGradient ?? section.gradient).toFixed(1)}% strongest sustained gradient`;
		return "";
	}
	function markExisting(pois, existing = []) {
		return pois.map(function (poi) {
			const alreadyPresent = existing.some(function (entry) {
				if (typeof entry.name !== "string" || entry.name.trim().toLowerCase() !== poi.name.trim().toLowerCase() || !Number.isFinite(entry.geometryDistance) ||
					!Number.isFinite(poi.geometryDistance) || Math.abs(entry.geometryDistance - poi.geometryDistance) >= 10 ||
					!Array.isArray(entry.point) || !entry.point.every(Number.isFinite)) return false;
				const radians = Math.PI / 180, latitude = (entry.point[1] - poi.point[1]) * radians,
					longitude = (entry.point[0] - poi.point[0]) * radians,
					value = Math.sin(latitude / 2) ** 2 + Math.cos(poi.point[1] * radians) * Math.cos(entry.point[1] * radians) * Math.sin(longitude / 2) ** 2;
				return 12742000 * Math.asin(Math.sqrt(Math.min(1, value))) < 10;
			});
			return { ...poi, alreadyPresent };
		});
	}
	function describe(result, options = {}) {
		const labels = { trail: "trails", technical: "technical trails", gravel: "gravel or dirt", track: "tracks", paved: "paved", unpaved: "unpaved", unknown: "of unknown character" },
			phrases = [],
			thirds = [];
		for (let third = 0; third < 3; third++) {
			const start = result.totalDistance * third / 3,
				end = result.totalDistance * (third + 1) / 3,
				distances = { trail: 0, technical: 0, gravel: 0, track: 0, paved: 0, unpaved: 0, unknown: 0 },
				wayDistances = {};
			for (const section of result.characterSections || []) {
				const length = Math.max(0, Math.min(end, section.end) - Math.max(start, section.start));
				distances[section.surfaceGroup || section.character] += length;
				if (section.wayType) {
					const label = wayLabel(section.wayType).toLowerCase();
					wayDistances[label] = (wayDistances[label] || 0) + length;
				}
			}
			const dominant = Object.keys(distances).sort((a, b) => distances[b] - distances[a])[0];
			let description = distances[dominant] / (end - start) >= 0.5 ? `mostly ${labels[dominant]}` : "mixed or incompletely mapped";
			const way = Object.keys(wayDistances).sort((a, b) => wayDistances[b] - wayDistances[a])[0];
			if (way && way !== "unknown" && wayDistances[way] / (end - start) >= 0.5)
				description += `, mainly ${way}`;
			thirds.push(description);
		}
		if (thirds.every((description) => description === thirds[0])) phrases.push(`The ride is ${thirds[0]}.`);
		else {
			phrases.push(`The first third is ${thirds[0]}.`);
			if (thirds[1] === thirds[2]) phrases.push(`The rest is ${thirds[1]}.`);
			else if (thirds[1].split(",")[0] === thirds[2].split(",")[0]) {
				phrases.push(`The rest is ${thirds[1].split(",")[0]}.`);
				for (const third of [1, 2]) {
					const way = thirds[third].split(", ")[1];
					if (way) phrases.push(`The ${third === 1 ? "middle" : "final"} third is ${way}.`);
				}
			}
			else {
				phrases.push(`The middle third is ${thirds[1]}.`);
				phrases.push(`The final third is ${thirds[2]}.`);
			}
		}
		for (const section of result.sections.filter((s) => s.kind === "hills").slice(0, 2))
			phrases.push(`Climbing is concentrated between kilometres ${(section.start / 1000).toFixed(1)} and ${(section.end / 1000).toFixed(1)}.`);
		if (Number.isFinite(result.climbingFinish) && result.climbingFinish < result.totalDistance * 0.9)
			phrases.push(`Most climbing is behind you by ${(result.climbingFinish / 1000).toFixed(1)} km.`);
		if (result.elevationCoverage < 1 - 1e-9 && options.includeCoverage !== false) phrases.push("Climbing information is incomplete because elevation is missing for part or all of the route.");
		return phrases.join(" ");
	}
	globalThis.KrbRideOverview = { DEFAULTS, preferences, fromRoute, fromKomoot, analyse, describe, breakdown, sectionDetail, markExisting, sectionCoordinates, RideOverviewError };
})();
