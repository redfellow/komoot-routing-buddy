// Run in the page context to style MapLibre layers without changing route geometry.
(function () {
	const originals = new Map();
	const rejectedPaintProperties = new WeakMap();
	const squadratsOriginals = new Map();
	const roadNumberOriginals = new Map();
	const colours = ["#26cd69", "#33b8ff", "#ffd400", "#ff493f", "#57575a", "#000000"];
	let map;
	let config;
	let scheduled;
	let applying = false;
	let needsApply = false;
	let searchAttempts = 0;

	// Contrast is measured against a controlled black halo, not unpredictable map pixels.
	function labelColour(hex) {
		const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
		function contrast(rgb) {
			const linear = rgb.map(function (channel) {
				const value = channel / 255;
				return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
			});
			return (0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2] + 0.05) / 0.05;
		}
		let adjusted = channels;
		// Mix toward white to brighten dark colours while retaining their colour family.
		while (contrast(adjusted) < 7)
			adjusted = adjusted.map((channel) => Math.ceil(channel + (255 - channel) * 0.05));
		return "#" + adjusted.map((channel) => channel.toString(16).padStart(2, "0")).join("");
	}

	function hexToRgb(hex) {
		const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
		return { r: channels[0], g: channels[1], b: channels[2] };
	}
	function rgbToHex({ r, g, b }) {
		return (
			"#" +
			[r, g, b]
				.map(function (channel) {
					return Math.max(0, Math.min(255, Math.round(channel)))
						.toString(16)
						.padStart(2, "0");
				})
				.join("")
		);
	}
	function rgbToHsl({ r, g, b }) {
		const red = r / 255;
		const green = g / 255;
		const blue = b / 255;
		const max = Math.max(red, green, blue);
		const min = Math.min(red, green, blue);
		const delta = max - min;
		let hue = 0;
		if (delta !== 0) {
			if (max === red) hue = ((green - blue) / delta) % 6;
			else if (max === green) hue = (blue - red) / delta + 2;
			else hue = (red - green) / delta + 4;
		}
		hue = Math.round(hue * 60);
		if (hue < 0) hue += 360;
		const lightness = (max + min) / 2;
		const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
		return { h: hue, s: saturation, l: lightness };
	}
	function hslToRgb({ h, s, l }) {
		const chroma = (1 - Math.abs(2 * l - 1)) * s;
		const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
		const match = l - chroma / 2;
		let red = 0;
		let green = 0;
		let blue = 0;
		if (h >= 0 && h < 60) [red, green, blue] = [chroma, x, 0];
		else if (h < 120) [red, green, blue] = [x, chroma, 0];
		else if (h < 180) [red, green, blue] = [0, chroma, x];
		else if (h < 240) [red, green, blue] = [0, x, chroma];
		else if (h < 300) [red, green, blue] = [x, 0, chroma];
		else [red, green, blue] = [chroma, 0, x];
		return {
			r: red * 255 + match * 255,
			g: green * 255 + match * 255,
			b: blue * 255 + match * 255,
		};
	}
	function toneTrailColour(hex, satellite) {
		if (satellite || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
		const rgb = hexToRgb(hex);
		const hsl = rgbToHsl(rgb);
		const dimmed = {
			h: hsl.h,
			s: Math.max(0, Math.min(1, hsl.s * 0.72)),
			l: Math.max(0, Math.min(1, hsl.l * 0.78)),
		};
		return rgbToHex(hslToRgb(dimmed));
	}
	function isMap(value) {
		return (
			value &&
			typeof value.getStyle === "function" &&
			typeof value.getCanvas === "function" &&
			typeof value.setPaintProperty === "function" &&
			document.contains(value.getCanvas())
		);
	}

	function findMap() {
		const queue = [];
		for (const canvas of document.querySelectorAll(
			"canvas.maplibregl-canvas, canvas.mapboxgl-canvas",
		)) {
			for (let element = canvas; element; element = element.parentElement) {
				for (const key of Object.getOwnPropertyNames(element)) {
					if (key.startsWith("__reactFiber$") || key.startsWith("__reactProps$"))
						queue.push(element[key]);
				}
			}
		}
		const seen = new Set();
		for (let index = 0; index < queue.length && index < 100000; index++) {
			const value = queue[index];
			if (
				!value ||
				typeof value !== "object" ||
				seen.has(value) ||
				value instanceof Node ||
				value === window
			)
				continue;
			seen.add(value);
			if (isMap(value)) return value;
			// Read data descriptors only: never invoke arbitrary React/browser getters.
			for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
				if (descriptor.value && typeof descriptor.value === "object" && queue.length < 100000)
					queue.push(descriptor.value);
			}
		}
		return null;
	}

	//check map properties dynamically mmkay.
	function levelExpression(nativeMtb = false) {
		const value = [
			"to-string",
			["coalesce", ["get", "mtb_scale"], ["get", "sac_scale"], ["get", "trail_difficulty"], "none"],
		];
		const expression = ["match", nativeMtb ? ["to-string", ["get", "mtb_scale"]] : value];
		//store the values
		for (let level = 0; level <= 5; level++) {
			expression.push(
				[
					String(level),
					`${level}+`,
					`${level}-`,
					`S${level}`,
					`s${level}`,
					`T${level}`,
					`t${level}`,
				],
				level,
			);
		}
		expression.push(-1);
		return expression;
	}

	// Keep zoom at the top level, as required by MapLibre's expression grammar.
	function transformStops(value, transform, fallback) {
		if (value && !Array.isArray(value) && Array.isArray(value.stops) && !value.property) {
			const result = ["interpolate", ["exponential", value.base ?? 1], ["zoom"]];
			for (const [zoom, output] of value.stops) result.push(zoom, transform(output));
			return result;
		}
		if (Array.isArray(value) && value[0] === "interpolate" && value[2]?.[0] === "zoom") {
			return value.map(function (entry, index) {
				return index >= 4 && index % 2 === 0 ? transform(entry) : entry;
			});
		}
		if (Array.isArray(value) && value[0] === "step" && value[1]?.[0] === "zoom") {
			return value.map(function (entry, index) {
				return index >= 2 && index % 2 === 0 ? transform(entry) : entry;
			});
		}
		return transform(value ?? fallback);
	}

	function same(left, right) {
		return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
	}

	function setFilter(id, value) {
		if (!same(map.getFilter(id), value)) map.setFilter(id, value ?? null);
	}

	function getPaint(id, property) {
		try {
			return map.getPaintProperty(id, property);
		}
		catch (error) {
			const layer = map.getStyle()?.layers?.find((candidate) => candidate.id === id);
			if (!layer) throw error;
			return layer.paint?.[property];
		}
	}

	function setPaint(id, property, value) {
		const layer = map.getLayer(id);
		const rejected = layer && rejectedPaintProperties.get(layer);
		if (rejected?.has(property)) return false;
		if (same(getPaint(id, property), value)) return true;
		try {
			map.setPaintProperty(id, property, value ?? null);
			return true;
		}
		catch (error) {
			if (!["line-gap-width", "line-gap-color"].includes(property) || !layer) throw error;
			const properties = rejected || new Set();
			properties.add(property);
			rejectedPaintProperties.set(layer, properties);
			return false;
		}
	}

	function setLayout(id, property, value) {
		if (!same(map.getLayoutProperty(id, property), value))
			map.setLayoutProperty(id, property, value ?? null);
	}
	// Stretch only the centre so borders and corners stay crisp around longer refs.
	function installRoadShields() {
		for (const [kind, colour] of Object.entries({ main: [209, 88, 88], national: [239, 196, 64], regional: [255, 255, 255], local: [58, 105, 175], unknown: [82, 91, 101] })) {
			const id = `krb-road-shield-${kind}`;
			if (map.hasImage(id)) continue;
			const width = 40, height = 32, data = new Uint8Array(width * height * 4);
			for (let y = 0; y < height; y++) {
				for (let x = 0; x < width; x++) {
					const dx = Math.max(Math.abs(x + 0.5 - width / 2) - 12, 0),
						dy = Math.max(Math.abs(y + 0.5 - height / 2) - 8, 0),
						edge = 8 - Math.hypot(dx, dy), offset = (y * width + x) * 4,
						border = kind === "national" || kind === "regional" ? [35, 45, 50] : [255, 255, 255],
						rgb = edge >= 1 && edge < 2 ? border : colour;
					data.set([...rgb, Math.round(Math.max(0, Math.min(1, edge)) * 255)], offset);
				}
			}
			map.addImage(id, { width, height, data }, { pixelRatio: 2, stretchX: [[12, 28]], stretchY: [[8, 24]], content: [4, 4, 36, 28] });
		}
	}
	// Finnish-style reference categories take precedence over physical highway class.
	function roadShieldClass(layer) {
		const roadClass = ["coalesce", ["get", "highway"], ["get", "class"], ["get", "type"], layer.id.replace(/^label-road-/, "").split("-")[0]];
		const fallback = ["match", roadClass,
			["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link"], "main",
			["secondary", "secondary_link", "tertiary", "tertiary_link", "minor", "unclassified", "residential", "service"], "local", "unknown"];
		const ref = ["to-string", ["coalesce", ["get", "ref"], ""]], number = ["to-number", ref, 0];
		return ["case", ["all", ["==", ["to-string", number], ref], ["<=", 1, number]],
			["case", ["<=", number, 39], "main", ["<=", number, 99], "national", ["<=", number, 999], "regional", ["<=", number, 9999], "local", "unknown"], fallback];
	}
	function removeRoadShield(saved) {
		if (map.getLayer(saved.shieldId)) map.removeLayer(saved.shieldId);
	}
	function applyRoadNumbers() {
		const layers = (map.getStyle()?.layers || []).filter(function (layer) {
			return layer.type === "symbol" && layer["source-layer"] === "road-label" &&
				/^label-road-/.test(layer.id) && layer.layout?.["text-field"] !== undefined;
		});
		const ids = new Set(layers.map((layer) => layer.id));
		for (const [id, saved] of roadNumberOriginals) {
			if (!ids.has(id) || saved.layer !== map.getLayer(id)) {
				removeRoadShield(saved);
				roadNumberOriginals.delete(id);
			}
		}
		if (config.visualsEnabled === false || config.emphasizeRoadNumbers !== true) {
			for (const [id, saved] of roadNumberOriginals) {
				removeRoadShield(saved);
				setLayout(id, "text-field", saved.field);
			}
			roadNumberOriginals.clear();
			return;
		}
		installRoadShields();
		const ref = ["to-string", ["coalesce", ["get", "ref"], ""]], hasRef = ["!=", ref, ""];
		for (const layer of layers) {
			if (!roadNumberOriginals.has(layer.id)) {
				roadNumberOriginals.set(layer.id, { layer: map.getLayer(layer.id),
					field: structuredClone(map.getLayoutProperty(layer.id, "text-field")), shieldId: `krb-road-number-${layer.id}` });
			}
			const saved = roadNumberOriginals.get(layer.id), kind = roadShieldClass(layer),
				referenceOnly = JSON.stringify(saved.field).includes("ref") && !JSON.stringify(saved.field).includes("name");
			// Keep street names in their native layer; replace existing ref-only labels.
			if (referenceOnly) setLayout(layer.id, "text-field", "");
			if (map.getLayer(saved.shieldId)) continue;
			const shield = { id: saved.shieldId, type: "symbol", source: layer.source, "source-layer": layer["source-layer"],
				layout: {
					"symbol-placement": layer.layout["symbol-placement"] || "line",
					"symbol-spacing": 600,
					"text-padding": 12,
					"icon-padding": 3,
					"text-field": ["case", hasRef, ref, ""],
					"text-font": Array.isArray(layer.layout["text-font"]) && layer.layout["text-font"].every((font) => typeof font === "string")
						? layer.layout["text-font"].map((font) => font === "Satoshi Regular" ? "Satoshi Bold" : font)
						: layer.layout["text-font"] || ["Open Sans Regular"],
					"text-size": transformStops(layer.layout["text-size"], function (value) {
						return ["*", value, ["match", kind, "main", 1.05, "national", 1, "local", 0.75, 0.9]];
					}, 11),
					"text-offset": referenceOnly ? [0, 0] : [0, -1.4],
					"text-rotation-alignment": "viewport",
					"icon-rotation-alignment": "viewport",
					"icon-image": ["case", hasRef, ["match", kind, "main", "krb-road-shield-main", "national", "krb-road-shield-national", "regional", "krb-road-shield-regional", "local", "krb-road-shield-local", "krb-road-shield-unknown"], ""],
					"icon-text-fit": "both", "icon-text-fit-padding": [1, 2, 1, 2],
				}, paint: { "text-color": ["match", kind, ["national", "regional"], "#232d32", "#ffffff"], "text-halo-width": 0 } };
			for (const property of ["minzoom", "maxzoom", "filter"]) {
				if (layer[property] !== undefined) shield[property] = structuredClone(layer[property]);
			}
			// Give emphasized numbers priority over native one-way arrows and labels.
			map.addLayer(shield);
		}
	}

	let inspectionMode = false;
	const inspectionOriginals = new Map();
	function applyInspection() {
		for (const [id, saved] of inspectionOriginals) {
			if (map.getLayer(id) !== saved.layer) inspectionOriginals.delete(id);
		}
		if (!inspectionMode) {
			for (const [id, saved] of inspectionOriginals) {
				for (const [property, value] of Object.entries(saved.paint)) setPaint(id, property, value);
				if (saved.hidden) setLayout(id, "visibility", saved.visibility);
			}
			inspectionOriginals.clear();
			return;
		}
		const mainRoute = map.getLayer("komoot-tour-routed");
		let routeColour = mainRoute && (inspectionOriginals.get(mainRoute.id)?.paint["line-color"] ?? getPaint(mainRoute.id, "line-color"));
		while (Array.isArray(routeColour) && ["case", "match", "step"].includes(routeColour[0])) routeColour = routeColour.at(-1);
		routeColour ??= "rgba(0, 88, 202, 1)";
		for (const layer of map.getStyle()?.layers || []) {
			const route = layer.source === "komoot_tour" && layer.type === "line",
				hidden = layer.id.startsWith("squadrats-") || /heatmap/i.test(`${layer.id} ${layer.source || ""}`) ||
					["komoot_tour_surface", "komoot_original_track"].includes(layer.source) ||
					(layer.source === "komoot_tour" && (/-border$/.test(layer.id) || layer.type === "symbol"));
			if (!route && !hidden) continue;
			let saved = inspectionOriginals.get(layer.id);
			if (!saved) {
				saved = { layer: map.getLayer(layer.id), paint: {}, hidden, visibility: structuredClone(map.getLayoutProperty(layer.id, "visibility")) };
				if (route) {
					for (const property of ["line-width", "line-gap-width", "line-blur", "line-color", "line-opacity", "line-offset", "line-dasharray", "line-pattern", "line-gradient", "line-translate"])
						saved.paint[property] = structuredClone(getPaint(layer.id, property));
				}
				inspectionOriginals.set(layer.id, saved);
			}
			if (route) {
				setPaint(layer.id, "line-width", 1);
				setPaint(layer.id, "line-gap-width", 0);
				setPaint(layer.id, "line-blur", 0);
				setPaint(layer.id, "line-color", routeColour);
				setPaint(layer.id, "line-opacity", 1);
				setPaint(layer.id, "line-offset", 0);
				setPaint(layer.id, "line-dasharray", undefined);
				setPaint(layer.id, "line-pattern", undefined);
				setPaint(layer.id, "line-gradient", undefined);
				setPaint(layer.id, "line-translate", [0, 0]);
			}
			if (hidden) setLayout(layer.id, "visibility", "none");
		}
	}


	function restore(keep = new Set()) {
		for (const [id, original] of originals) {
			if (keep.has(id)) continue;
			originals.delete(id);
			if (map.getLayer(id) !== original.layer) continue;
			setFilter(id, original.filter);
			for (const [property, value] of Object.entries(original.paint)) setPaint(id, property, value);
			for (const [property, value] of Object.entries(original.layout || {}))
				setLayout(id, property, value);
		}
	}

	const squadratsOrder = new Map();
	function orderSquadrats() {
		if (!map.moveLayer) return;
		const layers = map.getStyle()?.layers || [];
		const overlays = layers.filter(
			(layer) => layer.id.startsWith("squadrats-") && ["fill", "line"].includes(layer.type),
		);
		for (const [id, saved] of squadratsOrder) {
			if (map.getLayer(id) !== saved.layer) squadratsOrder.delete(id);
		}
		if (config.visualsEnabled === false || config.squadratsBelowRoads === false) {
			for (const [id, saved] of [...squadratsOrder].reverse()) {
				const next = saved.following.find((candidate) => map.getLayer(candidate));
				map.moveLayer(id, next);
			}
			squadratsOrder.clear();
			return;
		}
		if (!overlays.length) return;
		// Raster basemaps are indivisible: never move the overlay behind imagery.
		const rasterIndex = layers.reduce(function (last, layer, index) {
			return layer.type === "raster" &&
				layer.layout?.visibility !== "none" &&
				layer.paint?.["raster-opacity"] !== 0
				? index
				: last;
		}, -1);
		const anchorIndex = layers.findIndex(function (layer, index) {
			return (
				index > rasterIndex &&
				layer.type === "line" &&
				!layer.id.startsWith("squadrats-") &&
				!layer.id.startsWith("krb-") &&
				/(?:road|street|path|track|trail|footway|cycleway|steps|mtb|highway)/i.test(layer.id)
			);
		});
		if (anchorIndex < 0) return;
		// Never raise an overlay that Squadrats already placed below the roads.
		// Gathering every layer here used to lift low masks above intervening
		// land/water fills and expose a second grid.
		const anchor = layers[anchorIndex];
		const moving = overlays.filter((layer) => layers.indexOf(layer) > anchorIndex);
		if (!moving.length) return;
		// Keep the native relative order, moving higher layers down only.
		for (const layer of moving) {
			if (!squadratsOrder.has(layer.id))
				squadratsOrder.set(layer.id, {
					layer: map.getLayer(layer.id),
					following: layers
						.slice(layers.findIndex((item) => item.id === layer.id) + 1)
						.map((item) => item.id),
				});
			map.moveLayer(layer.id, anchor.id);
		}
	}

	function applySquadrats() {
		orderSquadrats();
		if (config.visualsEnabled === false) {
			for (const [id, original] of squadratsOriginals) {
				if (map.getLayer(id) === original.layer && same(getPaint(id, original.property), original.applied))
					setPaint(id, original.property, original.value);
			}
			squadratsOriginals.clear();
			return;
		}
		const percent = Number.isFinite(config.squadratsOpacity)
			? Math.max(0, Math.min(100, config.squadratsOpacity))
			: 50;
		const sources = new Set([
			"squadrats-source",
			"squadrats-new-squadrats",
			"squadrats-new-squadratinhos",
			"squadrats-grid",
			"squadrats-gridinho",
		]);
		const layers = (map.getStyle()?.layers || []).filter(function (layer) {
			return (
				layer.id.startsWith("squadrats-") &&
				sources.has(layer.source) &&
				["fill", "line"].includes(layer.type)
			);
		});
		const ids = new Set(layers.map((layer) => layer.id));
		for (const id of squadratsOriginals.keys()) if (!ids.has(id)) squadratsOriginals.delete(id);
		for (const layer of layers) {
			const property = `${layer.type}-opacity`;
			const live = map.getLayer(layer.id);
			const current = map.getPaintProperty(layer.id, property);
			let original = squadratsOriginals.get(layer.id);
			if (!original || original.layer !== live) {
				original = {
					layer: live,
					property,
					value: structuredClone(current),
					applied: structuredClone(current),
				};
				squadratsOriginals.set(layer.id, original);
			}
			else if (!same(current, original.applied)) {
				if (same(current, original.value)) original.applied = structuredClone(current);
				else {
					original.value = structuredClone(current);
					original.applied = structuredClone(current);
				}
			}
			const newSquares = ["squadrats-new-squadrats", "squadrats-new-squadratinhos"].includes(
				layer.source,
			);
			const effectivePercent = newSquares ? Math.min(100, percent * 2) : percent;
			const value =
				effectivePercent === 100
					? original.value
					: transformStops(original.value, (base) => ["*", base, effectivePercent / 100], 1);
			setPaint(layer.id, property, value);
			original.applied = structuredClone(value);
		}
	}

	function canSeparateStrokes(value) {
		if (typeof value === "number") return value !== 0;
		if (value == null) return false;
		if (Array.isArray(value.stops)) {
			return value.stops.some((stop) => canSeparateStrokes(stop[1]));
		}
		if (!Array.isArray(value)) return false;
		const [operator] = value;
		// Inspect outputs only; zoom stops and match labels are not widths.
		if (operator === "literal") return canSeparateStrokes(value[1]);
		if (operator === "interpolate") {
			return value.some(
				(entry, index) => index >= 4 && index % 2 === 0 && canSeparateStrokes(entry),
			);
		}
		if (operator === "step" || operator === "case" || operator === "match") {
			const start = operator === "match" ? 3 : 2;
			for (let index = start; index < value.length; index += 2) {
				if (canSeparateStrokes(value[index])) return true;
			}
			return operator !== "step" && canSeparateStrokes(value.at(-1));
		}
		// Unknown expressions alone are not evidence of a double-line marking.
		return false;
	}

	function hasSeparatedStrokes(id) {
		return ["line-gap-width", "line-offset"].some(function (property) {
			// Our own gap is a halo, not evidence of native separated strokes.
			const original = originals.get(id);
			const current = getPaint(id, property);
			const value = property === "line-gap-width" &&
				original && "appliedGap" in original && same(current, original.appliedGap)
				? original.paint[property]
				: current;
			return canSeparateStrokes(value);
		});
	}

	function isTrackLayer(id) {
		return /(?:^|[-_])tracks?(?:$|[-_])/i.test(id);
	}

	function preserveTrackWidth(base, widened) {
		return [
			"case",
			["any", ["==", ["get", "highway"], "track"], ["==", ["get", "class"], "track"]],
			base,
			widened,
		];
	}

	const hazardIconUrl = document.currentScript?.dataset.hazardIcons;
	const hazardCategories = ["mud", "vegetation", "narrow", "other", "log"];
	let hazardIconAtlas;
	let hazardIconsLoading = false;
	function installHazardIcons() {
		if (!map.addImage || !hazardIconUrl) return false;
		if (!hazardIconAtlas) {
			if (!hazardIconsLoading) {
				hazardIconsLoading = true;
				const image = new Image();
				image.crossOrigin = "anonymous";
				image.onload = function () {
					hazardIconAtlas = image;
					scheduleApply();
				};
				image.onerror = function () {
					console.warn("KRB hazard icons could not load");
				};
				image.src = hazardIconUrl;
			}
			return false;
		}
		for (const [index, category] of hazardCategories.entries()) {
			const id = `krb-hazard-${category}`;
			if (map.hasImage(id)) continue;
			const canvas = document.createElement("canvas");
			canvas.width = canvas.height = 56;
			const ctx = canvas.getContext("2d");
			ctx.drawImage(hazardIconAtlas, index * 56, 0, 56, 56, 0, 0, 56, 56);
			map.addImage(id, ctx.getImageData(0, 0, 56, 56), { pixelRatio: 2 });
		}
		return true;
	}

	let hazardTimer;
	let hazardRetries = 0;
	let hazardRequest = 0;
	let hazardKey;
	let hazardData;
	let hazardEnabled = false;
	const hazardIds = [
		"krb-conditions-line",
		"krb-conditions-point",
		"krb-conditions-label",
		"krb-conditions-trail-icons",
		...hazardCategories.flatMap(function (key) {
			return [`krb-conditions-icon-point-${key}`, `krb-conditions-icon-line-${key}`];
		}),
	];
	let latestHazardStatus;
	function hazardStatus(text, state = "idle", counts) {
		latestHazardStatus = { type: "KRB_HAZARD_STATUS", text, state, counts };
		window.postMessage(latestHazardStatus, location.origin);
	}
	function hideHazardTooltip() {
		window.postMessage({ type: "KRB_HAZARD_TOOLTIP", text: "" }, location.origin);
	}
	function showHazardTooltip(event) {
		if (!hazardEnabled) return hideHazardTooltip();
		const layers = hazardIds.filter((id) => map.getLayer(id));
		const features = layers.length ? map.queryRenderedFeatures(event.point, { layers }) : [];
		const feature =
			features.find((item) => item.layer?.id?.startsWith("krb-conditions-icon-")) || features[0];
		if (!feature) return hideHazardTooltip();
		const rect = map.getCanvas().getBoundingClientRect();
		window.postMessage(
			{
				type: "KRB_HAZARD_TOOLTIP",
				text: feature.layer?.id?.startsWith("krb-conditions-icon-")
					? feature.properties[`tip_${feature.layer.id.split("-").at(-1)}`]
					: feature.properties.label,
				x: rect.left + event.point.x,
				y: rect.top + event.point.y,
			},
			location.origin,
		);
	}
	function removeHazards() {
		hideHazardTooltip();
		for (const id of [...hazardIds].reverse()) if (map.getLayer(id)) map.removeLayer(id);
		if (map.getSource?.("krb-conditions")) map.removeSource("krb-conditions");
	}
	function isSatelliteMap() {
		const style = map.getStyle();
		return (style?.layers || []).some(function (layer) {
			return (
				layer.type === "raster" &&
				layer.layout?.visibility !== "none" &&
				layer.paint?.["raster-opacity"] !== 0 &&
				/satellite|aerial|imagery/i.test(
					JSON.stringify([layer.id, layer.source, style.sources?.[layer.source]]),
				)
			);
		});
	}
	function applyNarrowThreshold(data, threshold) {
		return {
			...data,
			features: data.features.map(function (feature) {
				const p = { ...feature.properties };
				// Older cache entries retain the OSM description but predate barrier-log icons.
				if (
					/(?:^| · )(?:barrier|obstacle):\s*(?:[^·]*;\s*)?(?:log|fallen_tree|tree_trunk)(?:\s*;| · |$)/.test(
						p.label || "",
					)
				) {
					p.log = true;
					p.icon_log = true;
					p.icon_other = false;
					p.tip_log = "Log / fallen tree";
				}
				const width =
					p.widthMetres ??
					Number(
						String(p.widthLabel || "")
							.replace(/^≈/, "")
							.replace(/m$/, ""),
					);
				p.icon_narrow = width > 0 && width <= threshold;
				if (p.icon_narrow) p.icon_other = false;
				const keys = ["mud", "vegetation", "narrow", "log", "other"];
				const active = keys.filter((key) => p[`icon_${key}`]);
				for (const key of keys)
					p[`offset_${key}`] = (active.indexOf(key) - (active.length - 1) / 2) * 30;
				return { ...feature, properties: p };
			}),
		};
	}
	let renderedHazardData;
	let renderedNarrowThreshold;
	function hazardDotColour() {
		const expression = ["match", ["get", "trailRating"]];
		for (let level = 0; level <= 5; level++) {
			const selected = config.colours?.[`S${level}`];
			const colour = /^#[0-9a-f]{6}$/i.test(selected) ? selected : colours[level];
			const darker =
				"#" +
				[1, 3, 5]
					.map(function (offset) {
						return Math.round(parseInt(colour.slice(offset, offset + 2), 16) * 0.6)
							.toString(16)
							.padStart(2, "0");
					})
					.join("");
			expression.push([`S${level}`, `S${level}+`, `S${level}-`], darker);
		}
		expression.push("#333333");
		return expression;
	}
	function drawHazards() {
		if (!hazardEnabled || !hazardData || !map.addSource) return;
		const threshold = Number.isFinite(config.narrowWarningWidth)
			? Math.round(Math.max(0.2, Math.min(1, config.narrowWarningWidth)) * 10) / 10
			: 0.4;
		const hazardSource = map.getSource("krb-conditions");
		if (
			!hazardSource ||
			renderedHazardData !== hazardData ||
			renderedNarrowThreshold !== threshold
		) {
			const data = applyNarrowThreshold(hazardData, threshold);
			if (hazardSource) hazardSource.setData(data);
			else
				map.addSource("krb-conditions", {
					type: "geojson",
					data,
					attribution: "© OpenStreetMap contributors",
				});
			renderedHazardData = hazardData;
			renderedNarrowThreshold = threshold;
		}
		// Use a font served by the host style. MapLibre's default Open Sans stack
		// returns 403 on Komoot and can leave every tile of this source blank.
		const symbols = (map.getStyle()?.layers || []).filter(
			(layer) => layer.type === "symbol" && !layer.id.startsWith("krb-conditions"),
		);
		const difficultyLabel = symbols.find(function (layer) {
			return (
				layer.layout?.visibility !== "none" &&
				/mtb_scale/.test(JSON.stringify([layer.filter, layer.layout])) &&
				layer.layout?.["text-font"]
			);
		});
		const font = [difficultyLabel, ...symbols]
			.filter(Boolean)
			.filter((layer) => layer.type === "symbol" && !layer.id.startsWith("krb-conditions"))
			.map((layer) => layer.layout?.["text-font"])
			.find(function (value) {
				return (
					Array.isArray(value) &&
					value.length > 0 &&
					value.every((name) => typeof name === "string") &&
					!["case", "match", "step", "interpolate", "get", "literal"].includes(value[0])
				);
			});
		const satellite = isSatelliteMap();
		const widthPaint = {
			"text-color": satellite ? "#ffffff" : "#000000",
			"text-halo-color": satellite ? "#000000" : "#ffffff",
			"text-halo-width": 1,
		};
		const iconsReady = installHazardIcons();
		const excludedRatings = ["__no_grade__"];
		for (let grade = Number(config.maximumTrailLevel.slice(1)) + 1; grade <= 5; grade++)
			excludedRatings.push(`S${grade}`, `S${grade}+`, `S${grade}-`);
		const layers = [
			{
				id: hazardIds[0],
				type: "line",
				filter: [
					"all",
					["==", ["geometry-type"], "LineString"],
					["match", ["get", "trailRating"], excludedRatings, false, true],
				],
				paint: { "line-color": hazardDotColour(), "line-width": 2, "line-dasharray": [1, 5] },
			},
			{
				id: hazardIds[2],
				type: "symbol",
				filter: [
					"all",
					["==", ["geometry-type"], "LineString"],
					["!=", ["get", "trailRating"], ""],
					["!=", ["get", "widthLabel"], ""],
				],
				layout: {
					"text-font": font,
					"symbol-placement": "line",
					"text-field": ["get", "widthLabel"],
					"text-rotation-alignment": "viewport",
					"text-pitch-alignment": "viewport",
					"text-size": 12,
					"text-offset": [0, -1.5],
					"text-allow-overlap": false,
					"text-ignore-placement": false,
					"text-padding": 4,
				},
				paint: widthPaint,
			},
		];
		for (const category of hazardCategories) {
			for (const [kind, geometry] of [
				["point", "Point"],
				["line", "LineString"],
			]) {
				layers.push({
					id: `krb-conditions-icon-${kind}-${category}`,
					type: "symbol",
					filter: [
						"all",
						["==", ["geometry-type"], geometry],
						["==", ["get", `icon_${category}`], true],
					],
					layout: {
						"symbol-placement": kind === "line" ? "line" : "point",
						"symbol-spacing": 280,
						"icon-image": `krb-hazard-${category}`,
						"icon-size": 0.85,
						"icon-offset": [
							"match",
							["get", `offset_${category}`],
							...[-45, -30, -15, 15, 30, 45].flatMap(function (offset) {
								return [offset, ["literal", [offset, 0]]];
							}),
							["literal", [0, 0]],
						],
						"icon-rotation-alignment": "viewport",
						"icon-allow-overlap": true,
						"icon-ignore-placement": true,
						"icon-padding": 0,
					},
				});
			}
		}
		// Without a usable host font, keep geometry visible and defer labels.
		for (const layer of layers)
			if (
				(layer.id === hazardIds[2] ? Boolean(font) : layer.type !== "symbol" || iconsReady) &&
				!map.getLayer(layer.id)
			)
				map.addLayer({ ...layer, source: "krb-conditions", minzoom: 14 });
		if (map.getLayer(hazardIds[0])) {
			setPaint(hazardIds[0], "line-color", hazardDotColour());
			setFilter(hazardIds[0], layers[0].filter);
		}
		if (map.getLayer(hazardIds[2])) {
			setLayout(hazardIds[2], "text-font", font);
			for (const [property, value] of Object.entries(widthPaint)) {
				if (map.getPaintProperty(hazardIds[2], property) !== value)
					map.setPaintProperty(hazardIds[2], property, value);
			}
		}
	}
	function scheduleHazards() {
		if (!map?.getBounds) return;
		clearTimeout(hazardTimer);
		hazardRetries = 0;
		// Invalidate in-flight responses immediately, before the pan debounce.
		hazardRequest++;
		if (!hazardData) hazardKey = undefined;
		hazardTimer = setTimeout(updateHazards, 750);
	}
	function updateHazards() {
		if (!map || !hazardEnabled) return;
		if (map.getZoom() < 14) {
			hazardKey = undefined;
			hazardData = undefined;
			removeHazards();
			hazardStatus("Hazards: zoom in to load");
			return;
		}
		const b = map.getBounds();
		const bounds = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
		const key = bounds.map((value) => value.toFixed(4)).join(",");
		if (key === hazardKey) {
			drawHazards();
			return;
		}
		hazardKey = key;
		hazardData = undefined;
		removeHazards();
		hazardStatus("Loading OSM hazards…", "loading");
		window.postMessage(
			{ type: "KRB_HAZARD_VIEW", bounds, requestId: hazardRequest },
			location.origin,
		);
	}
	window.addEventListener("message", function (event) {
		if (
			event.source !== window ||
			event.origin !== location.origin ||
			event.data?.type !== "KRB_HAZARD_DATA"
		)
			return;
		if (!map || !hazardEnabled || event.data.requestId !== hazardRequest) return;
		if (event.data.error) {
			hazardKey = undefined;
			const retryMs = event.data.retryMs;
			const state = [429, 504].includes(event.data.status) ? "throttled" : "error";
			if (Number.isFinite(retryMs) && retryMs > 0 && !event.data.exhausted && hazardRetries < 3) {
				hazardRetries++;
				const delay = Math.max(30000, Math.min(300000, retryMs));
				hazardStatus(
					`Hazards: ${event.data.error}. Retrying in ${Math.ceil(delay / 1000)}s (${hazardRetries}/3)`,
					state,
				);
				clearTimeout(hazardTimer);
				hazardTimer = setTimeout(updateHazards, delay);
			}
			else hazardStatus(`Hazards: ${event.data.error}. Use Retry to try again.`, state);
			return;
		}
		const data = event.data.data;
		if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) return;
		hazardRetries = 0;
		hazardData = data;
		drawHazards();
		const counts = data.counts || { total: 0, mud: 0, vegetation: 0, narrow: 0, other: 0 };
		hazardStatus(
			`${counts.total} hazards in cached area: ${counts.mud} muddy, ${counts.vegetation} vegetation, ${counts.narrow} narrow (<1 m), ${counts.other} obstacle/warning features. Categories may overlap. ${data.features.length} features including width data.`,
			"finished",
			counts,
		);
	});

	function apply() {
		if (!map || !config || applying) return;
		applying = true;
		try {
			if (config.visualsEnabled === false) inspectionMode = false;
			applySquadrats();
			applyInspection();
			applyRoadNumbers();
			const preload =
				config.preloadRouteHazards === true &&
				config.showHazards === true &&
				config.visualsEnabled !== false;
			if (preload !== routePreloadEnabled) {
				routePreloadEnabled = preload;
				scheduleRoutePreload();
			}
			const hazardsAllowed = config.showHazards === true && config.visualsEnabled !== false;
			if (hazardEnabled !== hazardsAllowed) {
				hazardEnabled = hazardsAllowed;
				hazardKey = undefined;
				hazardRequest++;
				if (hazardEnabled) scheduleHazards();
				else {
					hazardData = undefined;
					removeHazards();
					hazardStatus("");
				}
			}
			drawHazards();
			if (config.visualsEnabled === false || inspectionMode) {
				restore();
				postStatus({ ready: true, enabled: config.visualsEnabled !== false, inspection: inspectionMode });
				return;
			}

			const styleLayers = (map.getStyle()?.layers || []).filter(
				(layer) => !layer.id.startsWith("krb-") && !layer.id.startsWith("squadrats-") &&
					!/^komoot_(?:tour|original_track|marked_tour|recorded_tour|recording_tour|back_to_tour|route_removed)/.test(layer.source || ""),
			);
			function difficultyMetadata(layer) {
				const original = originals.get(layer.id);
				// Our filter adds mtb_scale even to fallback/IMBA layers. Using
				// it for classification would alternate renderers on every pass.
				const filter = original?.layer === map.getLayer(layer.id)
					? original.filter
					: layer.filter;
				return JSON.stringify([filter, layer.layout]);
			}
			// Ignore zoom limits: a selected MTB overlay should retain its native
			// zoom behaviour rather than falling back to wider paths when zoomed out.
			const nativeLayers = styleLayers.filter(function (layer) {
				return (
					/mtb/i.test(layer.id) &&
					["line", "symbol"].includes(layer.type) &&
					difficultyMetadata(layer).includes("\"mtb_scale\"")
				);
			});
			// Difficulty labels remain visible even with the sport overlay off.
			const nativeMtb = nativeLayers.some(
				(layer) => layer.type === "line" && layer.layout?.visibility !== "none",
			);
			const layers = nativeMtb
				? nativeLayers
				: styleLayers.filter(function (layer) {
						return (
							(!nativeLayers.includes(layer) || layer.type === "symbol") &&
							["line", "symbol"].includes(layer.type) &&
							(/"(mtb_scale|sac_scale|trail_difficulty)"/.test(
								difficultyMetadata(layer),
							) ||
								/(path|track|footway|cycleway|trail|steps)/i.test(layer.id))
						);
					});
			// Undo the previous renderer before applying the newly selected one.
			// This also drops backups for removed/replaced style layers.
			restore(new Set(layers.map((layer) => layer.id)));
			const level = levelExpression(nativeMtb);
			const neutralLabels = config.colourLabels !== true;
			const satellite = isSatelliteMap();
			const max = Number(config.maximumTrailLevel.slice(1));
			const applied = [];

			for (const layer of layers) {
				const liveLayer = map.getLayer(layer.id);
				const colourProperty = layer.type === "line" ? "line-color" : "text-color";
				const opacityProperty = layer.type === "line" ? "line-opacity" : "text-opacity";
				if (!originals.has(layer.id) || originals.get(layer.id).layer !== liveLayer) {
					const paintBackup = {
						[colourProperty]: structuredClone(getPaint(layer.id, colourProperty)),
						[opacityProperty]: structuredClone(getPaint(layer.id, opacityProperty)),
					};
					if (layer.type === "line") {
						paintBackup["line-width"] = structuredClone(getPaint(layer.id, "line-width"));
						paintBackup["line-gap-width"] = structuredClone(getPaint(layer.id, "line-gap-width"));
						paintBackup["line-gap-color"] = structuredClone(getPaint(layer.id, "line-gap-color"));
					}

					originals.set(layer.id, {
						layer: liveLayer,
						filter: structuredClone(map.getFilter(layer.id)),
						paint: paintBackup,
					});
				}
				const original = originals.get(layer.id);
				if (layer.type === "symbol") {
					if (!original.layout)
						original.layout = Object.fromEntries(
							["text-allow-overlap", "text-ignore-placement", "text-padding"].map(
								function (property) {
									return [property, structuredClone(map.getLayoutProperty(layer.id, property))];
								},
							),
						);
					setLayout(layer.id, "text-allow-overlap", false);
					setLayout(layer.id, "text-ignore-placement", false);
					setLayout(layer.id, "text-padding", 4);
				}
				if (layer.type === "symbol" && !("text-halo-color" in original.paint)) {
					for (const property of ["text-halo-color", "text-halo-width", "text-halo-blur"]) {
						original.paint[property] = structuredClone(getPaint(layer.id, property));
					}
				}
				setFilter(layer.id, original.filter);
				const colour = transformStops(
					original.paint[colourProperty],
					function (base) {
						const expression = ["match", level];
						for (let index = 0; index <= 5; index++) {
							const mode = index > max ? "native" : config.rules[`S${index}`];
							const custom = config.colours?.[`S${index}`];
							const colour = /^#[0-9a-f]{6}$/i.test(custom) ? custom : colours[index];
							const selected = mode === "avoid" ? "#7a1016" : colour;
							const trailColour =
								(mode === "off" || mode === "native")
									? base
									: layer.type === "symbol"
										? labelColour(selected)
										: mode === "avoid"
											? selected
											: toneTrailColour(selected, satellite);
							expression.push(
								index,
								index > max ? base : layer.type === "symbol" && neutralLabels
									? satellite
										? "#ffffff"
										: "#000000"
									: trailColour,
							);
						}
						expression.push(base);
						return expression;
					},
					"#000000",
				);
				const opacity = transformStops(
					original.paint[opacityProperty],
					function (base) {
						const expression = ["match", level];
						for (let index = 0; index <= 5; index++)
							expression.push(index, index <= max && config.rules[`S${index}`] === "off" ? 0.2 : 1);
						expression.push(1);
						return ["*", base, expression];
					},
					1,
				);
				setPaint(layer.id, colourProperty, colour);
				setPaint(layer.id, opacityProperty, opacity);
				if (layer.type === "symbol") {
					for (const [property, value, fallback] of [
						[
							"text-halo-color",
							neutralLabels && !satellite ? "#ffffff" : "#000000",
							"rgba(0,0,0,0)",
						],
						["text-halo-width", neutralLabels ? 1 : 0.5, 0],
						["text-halo-blur", 0, 0],
					]) {
						setPaint(
							layer.id,
							property,
							transformStops(
								original.paint[property],
								function (base) {
									const expression = ["match", level];
									for (let index = 0; index <= 5; index++)
										expression.push(
											index,
											index > max || (!neutralLabels && config.rules[`S${index}`] === "off") ? base : value,
										);
									expression.push(base);
									return expression;
								},
								fallback,
							),
						);
					}
				}
				// Keep tracks at Komoot's native zoom-dependent width; widen single trails only.
				if (layer.type === "line" && !nativeMtb) {
					const preserveWidth = hasSeparatedStrokes(layer.id) || isTrackLayer(layer.id);
					const targetWidth = config.trailWidth || 4; //enforcing fallback just in case.
					const effectiveWidth = satellite ? targetWidth : Math.max(1, targetWidth - 1);
					const width = transformStops(
						original.paint["line-width"],
						function (base) {
							const expression = ["match", level];
							for (let index = 0; index <= 5; index++)
								expression.push(index, index > max ? base : preserveTrackWidth(base, ["max", base, effectiveWidth]));
							expression.push(base);
							return expression;
						},
						effectiveWidth,
					);
					setPaint(layer.id, "line-width", preserveWidth ? original.paint["line-width"] : width);
					if (!preserveWidth) {
						if (setPaint(layer.id, "line-gap-color", transformStops(original.paint["line-gap-color"], (base) => ["case", ["<=", level, max], satellite ? "rgba(0,0,0,0)" : "#000000", base], "rgba(0,0,0,0)"))) {
							setPaint(
								layer.id,
								"line-gap-width",
								transformStops(
									original.paint["line-gap-width"],
									(base) => ["case", ["<=", level, max], preserveTrackWidth(base, satellite ? 0 : 1), base],
									0,
								),
							);
							original.appliedGap = structuredClone(getPaint(layer.id, "line-gap-width"));
						}
					}
				}
				applied.push(layer.id);
			}
			postStatus({ ready: true, enabled: true, layers: applied });
		}
		catch (error) {
			console.error("Routing Buddy map styling failed:", error);
			postStatus({ ready: true, error: error.message });
		}
		finally {
			applying = false;
			if (needsApply) {
				needsApply = false;
				scheduleApply();
			}
		}
	}

	function postStatus(detail) {
		window.postMessage({ type: "KRB_MAP_STATUS", detail: { ...detail, squadratsAvailable: Boolean(squadratsEstimateContext().provider) || (map?.getStyle()?.layers || []).some((layer) => layer.id.startsWith("squadrats-")) } }, location.origin);
	}

	window.addEventListener("message", function (event) {
		if (
			event.source !== window ||
			event.origin !== location.origin ||
			event.data?.type !== "KRB_RELOAD_HAZARDS"
		)
			return;
		if (!map || !hazardEnabled) return;
		hazardKey = undefined;
		hazardData = undefined;
		removeHazards();
		scheduleHazards();
	});

	function routeAreas(geojson, center) {
		const features =
			geojson?.type === "FeatureCollection"
				? geojson.features
				: geojson?.type === "Feature"
					? [geojson]
					: [];
		const latStep = 0.009; // Roughly 1km cells, with a 300m margin.
		const lonStep = latStep / Math.max(0.1, Math.cos((center[1] * Math.PI) / 180));
		const areas = new Map();
		let samples = 0;
		function add(point) {
			const x = Math.floor(point[0] / lonStep),
				y = Math.floor(point[1] / latStep);
			const key = `${x},${y}`;
			if (!areas.has(key))
				areas.set(key, [
					(y - 0.3) * latStep,
					(x - 0.3) * lonStep,
					(y + 1.3) * latStep,
					(x + 1.3) * lonStep,
				]);
		}
		for (const feature of features || []) {
			const g = feature.geometry;
			const lines =
				g?.type === "LineString"
					? [g.coordinates]
					: g?.type === "MultiLineString"
						? g.coordinates
						: [];
			for (const line of lines) {
				let previous;
				for (const point of line) {
					if (
						!Array.isArray(point) ||
						!point.slice(0, 2).every(Number.isFinite) ||
						Math.abs(point[0]) > 179 ||
						Math.abs(point[1]) > 84
					) {
						previous = undefined;
						continue;
					}
					const steps = previous
						? Math.ceil(
								Math.max(
									Math.abs(point[0] - previous[0]) / lonStep,
									Math.abs(point[1] - previous[1]) / latStep,
								) * 5,
							)
						: 1;
					for (let i = 1; i <= Math.max(1, steps) && samples < 20000; i++, samples++) {
						add(
							previous
								? [
										previous[0] + ((point[0] - previous[0]) * i) / Math.max(1, steps),
										previous[1] + ((point[1] - previous[1]) * i) / Math.max(1, steps),
									]
								: point,
						);
					}
					previous = point;
					if (samples >= 20000) break;
				}
				if (samples >= 20000) break;
			}
			if (samples >= 20000) break;
		}
		const distance = function (b) {
			return (
				((b[1] + b[3]) / 2 - center[0]) ** 2 / lonStep ** 2 +
				((b[0] + b[2]) / 2 - center[1]) ** 2 / latStep ** 2
			);
		};
		return [...areas.values()].sort((a, b) => distance(a) - distance(b)).slice(0, 8);
	}
	let routePreloadTimer;
	let routePreloadEnabled = false;
	function scheduleRoutePreload() {
		clearTimeout(routePreloadTimer);
		window.postMessage({ type: "KRB_PRELOAD_ROUTE", areas: [] }, location.origin);
		if (!routePreloadEnabled || !map) return;
		routePreloadTimer = setTimeout(function () {
			if (!map || !routePreloadEnabled) return;
			const b = map.getBounds();
			const route = map.getSource("komoot_tour")?._data;
			window.postMessage(
				{
					type: "KRB_PRELOAD_ROUTE",
					areas: routeAreas(route, [
						(b.getWest() + b.getEast()) / 2,
						(b.getSouth() + b.getNorth()) / 2,
					]),
				},
				location.origin,
			);
		}, 2000);
	}
	let squadratsEstimateState = [], squadratsEstimateGeneration = 0, squadratsRefreshingCollection;
	function squadratsEstimateContext() {
		try {
			return {
				provider: typeof squadrats === "object" ? squadrats : undefined,
				tiler: typeof polylib === "object" ? polylib : undefined,
				encode: typeof MAP === "object" ? MAP.POLYLINE?.encodePolyline : undefined,
				polyline: typeof MAP === "object" ? MAP.POLYLINE : undefined,
			};
		}
		catch (error) {
			console.debug("Squadrats context not ready:", error.message);
			return {};
		}
	}
	function watchSquadratsEstimate(notify = true) {
		const enabled = config?.visualsEnabled !== false && config?.estimateSquadrats === true,
			context = enabled ? squadratsEstimateContext() : {},
			provider = context.provider,
			state = [enabled, provider, provider?.enabled, provider?.config, context.tiler, context.encode,
				provider?.raw?.[14], provider?.raw?.[17], provider?.raw?.[14]?.size, provider?.raw?.[17]?.size];
		// Never relabel a previous account's collection as the newly selected context.
		if (!enabled) squadratsRefreshingCollection = undefined;
		else if (squadratsEstimateState[3] && state[3] !== squadratsEstimateState[3] &&
			state[6] === squadratsEstimateState[6] && state[7] === squadratsEstimateState[7])
			squadratsRefreshingCollection = [state[6], state[7]];
		if (squadratsRefreshingCollection && state[6] !== squadratsRefreshingCollection[0] && state[7] !== squadratsRefreshingCollection[1])
			squadratsRefreshingCollection = undefined;
		if (state.some((value, index) => value !== squadratsEstimateState[index])) {
			squadratsEstimateState = state;
			squadratsEstimateGeneration++;
			if (notify) window.postMessage({ type: "KRB_SQUADRATS_CHANGED", enabled }, location.origin);
		}
		return { enabled, context, generation: squadratsEstimateGeneration };
	}
	function readSquadratsEstimate(snapshot) {
		const { enabled, context, generation } = watchSquadratsEstimate(false);
		if (!enabled) return { status: "disabled", generation };
		if (squadratsRefreshingCollection) return { status: "unavailable", message: "Squadrats collection is refreshing.", generation };
		try {
			const data = globalThis.KrbSquadratsEstimate?.read(context, rideCoordinates(snapshot.route));
			return { ...(data || { status: "unavailable", message: "Squadrats estimator is not ready." }), generation };
		}
		catch (error) {
			return { status: "unavailable", message: error.message, generation };
		}
	}

	let checkedRouteKey;
	let routeHighlightTimer;
	let routePreviewTimer, routePreviewId;
	function rideCoordinates(route, returnTour = false) {
		const rendered = [];
		for (const feature of route.features) {
			const lines = feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
			for (const line of lines) {
				for (const point of line) {
					const previous = rendered.at(-1);
					if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) rendered.push(point);
				}
			}
		}
		const queue = [];
		for (const element of document.querySelectorAll("*")) {
			for (const key of Object.getOwnPropertyNames(element)) {
				if (key.startsWith("__reactFiber$")) queue.push(element[key]);
			}
		}
		const seen = new Set();
		for (let index = 0; index < queue.length && index < 100000; index++) {
			const value = queue[index];
			if (!value || typeof value !== "object" || seen.has(value) || value instanceof Node || value === window) continue;
			seen.add(value);
			// The editor's props identify the active tour; rendered sources can contain duplicate overlays.
			if (value.page && value.tour?.attributes?.type === "tour_planned" && typeof value.tour.link === "function") {
				const active = value.tour, items = active.link("coordinates")?.get?.("items");
				if (Array.isArray(items) && items.length >= 2 && items.length <= 250000) {
					if (returnTour) return active;
					return items.map((point) => ({ lat: point.lat, lng: point.lng, alt: Number.isFinite(point.alt) ? point.alt : undefined }));
				}
			}
			if (value.attributes?.type === "tour_planned" && typeof value.link === "function") {
				const coordinates = value.link("coordinates")?.get?.("items");
				if (Array.isArray(coordinates) && coordinates.length <= 250000) {
					const unique = coordinates.filter((point, i) => !i || point.lat !== coordinates[i - 1].lat || point.lng !== coordinates[i - 1].lng);
					if (unique.length === rendered.length && unique.every((point, i) => point.lng === rendered[i][0] && point.lat === rendered[i][1])) {
						if (returnTour) return value;
						return coordinates.map(function (point) {
							return { lat: point.lat, lng: point.lng, alt: Number.isFinite(point.alt) ? point.alt : undefined };
						});
					}
				}
			}
			for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
				if (descriptor.value && typeof descriptor.value === "object" && queue.length < 100000) queue.push(descriptor.value);
			}
		}
		return undefined;
	}
	function routeSnapshot() {
		const active = rideCoordinates({ features: [] }, true);
		if (active) {
			const items = active.link("coordinates").get("items"),
				segments = active.link("segments")?.models?.map((segment) => segment.attributes) || [],
				valid = segments.filter((segment) => Number.isInteger(segment.from) && Number.isInteger(segment.to) &&
					segment.from >= 0 && segment.to > segment.from && segment.to < items.length),
				features = valid.length ? valid.map(function (segment) {
					return { type: "Feature", properties: { segment_type: segment.type }, geometry: { type: "LineString",
						coordinates: items.slice(segment.from, segment.to + 1).map((point) => [point.lng, point.lat]) } };
				}) : [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: items.map((point) => [point.lng, point.lat]) } }],
				route = { type: "FeatureCollection", features };
			return { route, routeKey: JSON.stringify(route) };
		}
		const data = map?.getSource("komoot_tour")?._data;
		if (!data || typeof data !== "object") throw new Error("Komoot route is not ready");
		const features = (
			data.type === "FeatureCollection" ? data.features : data.type === "Feature" ? [data] : []
		)
			.filter((f) => ["LineString", "MultiLineString"].includes(f.geometry?.type))
			.map(function (f) {
				return {
					type: "Feature",
					geometry: f.geometry,
					properties: Object.fromEntries(
						["segment_type", "layer", "bridge", "tunnel"]
							.filter((key) => ["string", "number"].includes(typeof f.properties?.[key]))
							.map((key) => [key, f.properties[key]]),
					),
				};
			});
		if (!features.length) throw new Error("Draw or open a route first");
		const route = { type: "FeatureCollection", features };
		return { route, routeKey: JSON.stringify(route) };
	}
	function clearRouteHighlight() {
		clearRoutePreview();
		clearTimeout(routeHighlightTimer);
		if (map?.getLayer("krb-route-check-highlight")) map.removeLayer("krb-route-check-highlight");
		if (map?.getSource("krb-route-check-highlight")) map.removeSource("krb-route-check-highlight");
	}
	function clearRoutePreview() {
		clearTimeout(routePreviewTimer);
		routePreviewId = undefined;
		if (map?.getLayer("krb-route-preview")) map.removeLayer("krb-route-preview");
		if (map?.getSource("krb-route-preview")) map.removeSource("krb-route-preview");
	}
	function checkRouteChanged(reason) {
		if (poiOperation) return;
		if (config?.visualsEnabled !== false) {
			try {
				const snapshot = routeSnapshot();
				globalThis.KrbKomootPoiInsert?.clearStale?.(rideCoordinates(snapshot.route, true));
			}
			catch (error) {
				console.debug("Generated POI refresh unavailable:", error.message);
			}
		}
		if (!checkedRouteKey) return;
		let current;
		try {
			current = routeSnapshot().routeKey;
		}
		catch (error) {
			console.debug("Route unavailable:", error.message);
		}
		if (current !== checkedRouteKey) {
			checkedRouteKey = undefined;
			clearRouteHighlight();
			window.postMessage({ type: "KRB_ROUTE_CHANGED", reason: typeof reason === "string" ? reason : undefined }, location.origin);
		}
	}
	let poiOperation;
	const poiResults = new Map();
	async function addApprovedPois(message) {
		if (typeof message.requestId !== "string" || !/^poi:\d+$/.test(message.requestId)) return;
		if (poiResults.has(message.requestId)) {
			window.postMessage(poiResults.get(message.requestId), location.origin);
			return;
		}
		if (poiOperation) return;
		const operation = { id: message.requestId, cancelled: false, pathname: location.pathname };
		poiOperation = operation;
		let result, editingBody, previousInert;
		try {
			const snapshot = routeSnapshot(), tour = rideCoordinates(snapshot.route, true);
			if (message.routeKey !== snapshot.routeKey || message.routeKey !== checkedRouteKey)
				throw new Error("Route changed. Analyse again before adding POIs.");
			if (!/^\/(?:plan(?:\/|$)|tour\/[^/]+\/edit$)/.test(location.pathname))
				throw new Error("Open the Komoot route editor before adding POIs.");
			// Extension dialogs live outside body; they remain usable while native edits are paused.
			editingBody = document.body;
			previousInert = editingBody.inert;
			editingBody.inert = true;
			result = await globalThis.KrbKomootPoiInsert.insert(tour, message.pois, {
				cancelled: () => operation.cancelled || location.pathname !== operation.pathname,
				isCurrent: () => routeSnapshot().routeKey === message.routeKey,
			});
		}
		catch (error) {
			result = { error: error.message };
		}
		finally {
			if (editingBody) editingBody.inert = previousInert;
			poiOperation = undefined;
		}
		const reply = { type: "KRB_POI_RESULT", requestId: message.requestId, ...result };
		poiResults.set(message.requestId, reply);
		if (poiResults.size > 16) poiResults.delete(poiResults.keys().next().value);
		window.postMessage(reply, location.origin);
		if (result.added > 0) {
			checkedRouteKey = undefined;
			clearRouteHighlight();
			window.postMessage({ type: "KRB_ROUTE_CHANGED", reason: "poi-insertion" }, location.origin);
		}
		else checkRouteChanged();
	}
	window.addEventListener("message", function (event) {
		if (event.source !== window || event.origin !== location.origin) return;
		if (event.data?.type === "KRB_POI_CANCEL" && poiOperation?.id === event.data.requestId) poiOperation.cancelled = true;
		if (event.data?.type === "KRB_POI_ADD" && config?.visualsEnabled !== false) void addApprovedPois(event.data);
		if (event.data?.type === "KRB_SQUADRATS_REQUEST" && /^squadrats:\d+$/.test(event.data.requestId || "")) {
			if (config?.visualsEnabled === false || config?.estimateSquadrats !== true) {
				window.postMessage({ type: "KRB_SQUADRATS_DATA", requestId: event.data.requestId, routeKey: event.data.routeKey, data: { status: "disabled" } }, location.origin);
				return;
			}
			try {
				const snapshot = routeSnapshot();
				if (snapshot.routeKey !== event.data.routeKey) return;
				window.postMessage({ type: "KRB_SQUADRATS_DATA", requestId: event.data.requestId, routeKey: snapshot.routeKey,
					data: readSquadratsEstimate(snapshot) }, location.origin);
			}
			catch (error) {
				window.postMessage({ type: "KRB_SQUADRATS_DATA", requestId: event.data.requestId, routeKey: event.data.routeKey,
					data: { status: "unavailable", message: error.message } }, location.origin);
			}
		}
		if (event.data?.type === "KRB_ROUTE_SNAPSHOT") {
			try {
				const snapshot = routeSnapshot();
				if (event.data.includeProfile === true) {
					const active = rideCoordinates(snapshot.route, true);
					if (!active) throw new Error("Komoot route metadata is not ready. Try again when the route has loaded.");
					if (!poiOperation && config?.visualsEnabled !== false) globalThis.KrbKomootPoiInsert?.clearStale?.(active);
					snapshot.nativeProfile = {
						coordinates: rideCoordinates(snapshot.route),
						surfaces: active.link("surfaces")?.get?.("items"),
						wayTypes: active.link("way_types")?.get?.("items"),
						distance: active.get?.("distance"), ascent: active.get?.("elevation_up"),
						existingPois: globalThis.KrbKomootPoiInsert?.supported(active) ? globalThis.KrbKomootPoiInsert.existingPois(active) : [],
					};
					snapshot.poiAvailable = /^\/(?:plan(?:\/|$)|tour\/[^/]+\/edit$)/.test(location.pathname) &&
						globalThis.KrbKomootPoiInsert?.supported(rideCoordinates(snapshot.route, true)) === true;
				}
				checkedRouteKey = snapshot.routeKey;
				if (event.data.includeProfile === true) snapshot.squadratsEstimate = readSquadratsEstimate(snapshot);
				window.postMessage(
					{ type: "KRB_ROUTE_SNAPSHOT_DATA", requestId: event.data.requestId, ...snapshot },
					location.origin,
				);
			}
			catch (error) {
				window.postMessage(
					{
						type: "KRB_ROUTE_SNAPSHOT_DATA",
						requestId: event.data.requestId,
						error: error.message,
					},
					location.origin,
				);
			}
		}
		if (event.data?.type === "KRB_ROUTE_FOCUS" && map && config?.visualsEnabled !== false) {
			checkRouteChanged();
			if (!checkedRouteKey || event.data.routeKey !== checkedRouteKey) return;
			if (event.data.clearPreview === true) {
				if (event.data.previewId === routePreviewId) clearRoutePreview();
				return;
			}
			const preview = event.data.previewOnly === true;
			if (preview && (typeof event.data.previewId !== "string" || event.data.previewId.length > 100)) return;
			const { point, coordinates } = event.data;
			const valid = function (p) {
				return (
					Array.isArray(p) &&
					p.length >= 2 &&
					Number.isFinite(p[0]) &&
					Number.isFinite(p[1]) &&
					Math.abs(p[0]) <= 180 &&
					Math.abs(p[1]) <= 85
				);
			};
			if (
				!valid(point) ||
				!Array.isArray(coordinates) ||
				coordinates.length < 2 ||
				coordinates.length > 100000 ||
				!coordinates.every(valid)
			)
				return;
			const sections = event.data.sections;
			if (sections !== undefined && (!preview || !Array.isArray(sections) || !sections.length || sections.length > 10000 ||
				sections.some((line) => !Array.isArray(line) || line.length < 2) ||
				sections.reduce((count, line) => count + line.length, 0) > 100000 || !sections.every((line) => line.every(valid)))) return;
			if (preview && event.data.replaceHighlight !== true) clearRoutePreview();
			else clearRouteHighlight();
			try {
				const source = preview ? "krb-route-preview" : "krb-route-check-highlight",
					duration = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 600;
				map.addSource(source, {
					type: "geojson",
					data: { type: "Feature", properties: {}, geometry: sections ? { type: "MultiLineString", coordinates: sections } : { type: "LineString", coordinates } },
				});
				map.addLayer({
					id: source,
					source,
					type: "line",
					paint: { "line-color": "#ff00bb", "line-width": 8, "line-opacity": 0.8 },
				});
				if (preview) {
					routePreviewId = event.data.previewId;
					routePreviewTimer = setTimeout(clearRoutePreview, 8000);
					return;
				}
				if (event.data.fitSection === true && typeof map.fitBounds === "function") {
					const bounds = coordinates.reduce(function (box, p) {
						return [[Math.min(box[0][0], p[0]), Math.min(box[0][1], p[1])], [Math.max(box[1][0], p[0]), Math.max(box[1][1], p[1])]];
					}, [[point[0], point[1]], [point[0], point[1]]]),
						width = map.getContainer?.()?.clientWidth || window.innerWidth,
						right = Number.isFinite(event.data.paddingRight) ? Math.max(40, Math.min(event.data.paddingRight, width * 0.45)) : 64;
					map.fitBounds(bounds, { padding: { top: 64, bottom: 64, left: 64, right }, maxZoom: 17, duration });
				}
				else map.easeTo({ center: point, zoom: Math.max(map.getZoom(), 16), duration });
				routeHighlightTimer = setTimeout(clearRouteHighlight, 8000);
			}
			catch (error) {
				console.warn("Could not focus route warning:", error);
				if (preview) clearRoutePreview();
				else clearRouteHighlight();
			}
		}
	});
	function onRoutePreloadSource(event) {
		if (event.sourceId === "komoot_tour" && event.sourceDataType === "content") {
			checkRouteChanged();
			scheduleRoutePreload();
		}
	}

	const squadratsRouteSources = ["squadrats-new-squadrats", "squadrats-new-squadratinhos"];
	let squadratsWait;
	let squadratsFallback;
	function clearSquadratsWait() {
		clearTimeout(squadratsFallback);
		squadratsFallback = undefined;
		squadratsWait = undefined;
	}
	function finishSquadratsWait() {
		clearSquadratsWait();
		scheduleApply();
	}
	function onSquadratsSource(event) {
		if (config?.estimateSquadrats === true && event.sourceId?.startsWith("squadrats-")) watchSquadratsEstimate();
		if (event.sourceId === "komoot_tour" && event.sourceDataType === "content") {
			const present = (map.getStyle()?.layers || []).some(function (layer) {
				return layer.id.startsWith("squadrats-");
			});
			if (!present) return;
			clearTimeout(scheduled);
			scheduled = undefined;
			// A new route generation invalidates completions from the previous one.
			const active = squadratsRouteSources.filter((id) => map.getSource(id));
			squadratsWait = new Set(active.length ? active : squadratsRouteSources);
			// Do not let repeated route events postpone the fallback indefinitely.
			if (!squadratsFallback) squadratsFallback = setTimeout(finishSquadratsWait, 3000);
			return;
		}
		if (!squadratsWait?.has(event.sourceId) || event.sourceDataType !== "content") return;
		if (event.isSourceLoaded !== true) return;
		squadratsWait.delete(event.sourceId);
		if (!squadratsWait.size) finishSquadratsWait();
	}

	function scheduleApply() {
		if (squadratsWait) return;
		if (applying) {
			needsApply = true;
			return;
		}
		if (scheduled) return;
		// Squadrats debounces route data for 100ms. A faster styling pass can
		// repeatedly reset that timer through MapLibre style/data events.
		// Retain the verified quiet window after completion, including fallback.
		scheduled = setTimeout(function () {
			scheduled = undefined;
			apply();
		}, 500);
	}

	window.addEventListener("message", function (event) {
		if (
			event.source !== window ||
			event.origin !== location.origin ||
			!["KRB_MAP_CONFIG", "KRB_INSPECTION_MODE"].includes(event.data?.type)
		)
			return;
		if (event.data.type === "KRB_INSPECTION_MODE") {
			inspectionMode = config?.visualsEnabled !== false && event.data.active === true;
			scheduleApply();
			return;
		}
		const incoming = event.data.config;
		if (!incoming || !/^S[0-5]$/.test(incoming.maximumTrailLevel) || !incoming.rules) return;
		config = incoming;
		watchSquadratsEstimate();
		if (config.visualsEnabled === false) {
			clearSquadratsWait();
			clearTimeout(scheduled);
			scheduled = undefined;
			clearTimeout(hazardTimer);
			clearRouteHighlight();
			clearRoutePreview();
		}
		if (latestHazardStatus) window.postMessage(latestHazardStatus, location.origin);
		searchAttempts = 0;
		if (config.visualsEnabled === false) apply();
		else scheduleApply();
	});

	setInterval(function () {
		watchSquadratsEstimate();
		if (map && !document.contains(map.getCanvas())) {
			if (checkedRouteKey && !poiOperation) window.postMessage({ type: "KRB_ROUTE_CHANGED" }, location.origin);
			checkedRouteKey = undefined;
			clearRouteHighlight();
			map.off("styledata", scheduleApply);
			map.off("sourcedata", onSquadratsSource);
			map.off("sourcedata", onRoutePreloadSource);
			map.off("moveend", scheduleRoutePreload);
			routePreloadEnabled = false;
			scheduleRoutePreload();
			clearSquadratsWait();
			clearTimeout(scheduled);
			scheduled = undefined;
			map.off("moveend", scheduleHazards);
			map.off("mousemove", showHazardTooltip);
			map.off("click", showHazardTooltip);
			map.off("movestart", hideHazardTooltip);
			map.getCanvas().removeEventListener?.("mouseleave", hideHazardTooltip);
			hideHazardTooltip();
			hazardEnabled = false;
			hazardRequest++;
			hazardData = undefined;
			hazardKey = undefined;
			map = undefined;
			postStatus({ ready: false });
			originals.clear();
			squadratsOriginals.clear();
			roadNumberOriginals.clear();
			inspectionOriginals.clear();
			squadratsOrder.clear();
			searchAttempts = 0;
		}
		if (map || ++searchAttempts > 30) return;
		const found = findMap();
		if (!found) return;
		map = found;

		map.on("styledata", scheduleApply);
		// Idle also fires after panning and our own paint transitions. Style
		// changes already notify us through styledata; do not restyle every idle.
		map.on("sourcedata", onSquadratsSource);
		map.on("sourcedata", onRoutePreloadSource);
		map.on("moveend", scheduleRoutePreload);
		map.on("moveend", scheduleHazards);
		map.on("mousemove", showHazardTooltip);
		map.on("click", showHazardTooltip);
		map.on("movestart", hideHazardTooltip);
		map.getCanvas().addEventListener?.("mouseleave", hideHazardTooltip);
		postStatus({ ready: false });
		scheduleApply();
	}, 1000);
})();
