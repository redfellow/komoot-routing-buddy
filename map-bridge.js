// Run in the page context to style MapLibre layers without changing route geometry.
(function () {
	const originals = new Map();
	const rejectedPaintProperties = new WeakMap();
	const squadratsOriginals = new Map();
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
		if (config.squadratsBelowRoads === false) {
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
		const anchor = layers[anchorIndex].id;
		const expected = overlays.map((layer) => layer.id);
		const before = layers
			.slice(Math.max(0, anchorIndex - overlays.length), anchorIndex)
			.map((layer) => layer.id);
		if (same(before, expected)) return;
		// Keep Squadrats' internal fill/outline order and avoid redundant style events.
		for (const layer of overlays) {
			if (!squadratsOrder.has(layer.id))
				squadratsOrder.set(layer.id, {
					layer: map.getLayer(layer.id),
					following: layers
						.slice(layers.findIndex((item) => item.id === layer.id) + 1)
						.map((item) => item.id),
				});
			map.moveLayer(layer.id, anchor);
		}
	}

	function applySquadrats() {
		orderSquadrats();
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
			return canSeparateStrokes(getPaint(id, property));
		});
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
		const layers = [
			{
				id: hazardIds[0],
				type: "line",
				filter: ["==", ["geometry-type"], "LineString"],
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
		if (map.getLayer(hazardIds[0])) setPaint(hazardIds[0], "line-color", hazardDotColour());
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
			applySquadrats();
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
			if (config.visualsEnabled === false) {
				restore();
				postStatus({ ready: true, enabled: false });
				return;
			}

			const styleLayers = (map.getStyle()?.layers || []).filter(
				(layer) => !layer.id.startsWith("krb-conditions"),
			);
			// Ignore zoom limits: a selected MTB overlay should retain its native
			// zoom behaviour rather than falling back to wider paths when zoomed out.
			const nativeLayers = styleLayers.filter(function (layer) {
				return (
					/mtb/i.test(layer.id) &&
					["line", "symbol"].includes(layer.type) &&
					JSON.stringify([layer.filter, layer.layout]).includes("\"mtb_scale\"")
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
								JSON.stringify([layer.filter, layer.layout]),
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
				const allowed = ["any", ["==", level, -1], ["<=", level, max]];
				setFilter(layer.id, original.filter ? ["all", original.filter, allowed] : allowed);
				const colour = transformStops(
					original.paint[colourProperty],
					function (base) {
						const expression = ["match", level];
						for (let index = 0; index <= 5; index++) {
							const mode = config.rules[`S${index}`];
							const custom = config.colours?.[`S${index}`];
							const colour = /^#[0-9a-f]{6}$/i.test(custom) ? custom : colours[index];
							const selected = mode === "avoid" ? "#7a1016" : colour;
							const trailColour =
								mode === "off"
									? base
									: layer.type === "symbol"
										? labelColour(selected)
										: mode === "avoid"
											? selected
											: toneTrailColour(selected, satellite);
							expression.push(
								index,
								layer.type === "symbol" && neutralLabels
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
							expression.push(index, config.rules[`S${index}`] === "off" ? 0.2 : 1);
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
											!neutralLabels && config.rules[`S${index}`] === "off" ? base : value,
										);
									expression.push(base);
									return expression;
								},
								fallback,
							),
						);
					}
				}
				// Widen simple trails without distorting casings or parallel strokes.
				if (layer.type === "line" && !nativeMtb) {
					const preserveWidth = hasSeparatedStrokes(layer.id);
					const targetWidth = config.trailWidth || 4; //enforcing fallback just in case.
					const effectiveWidth = satellite ? targetWidth : Math.max(1, targetWidth - 1);
					const width = transformStops(
						original.paint["line-width"],
						function (base) {
							const expression = ["match", level];
							for (let index = 0; index <= 5; index++)
								expression.push(index, ["max", base, effectiveWidth]);
							expression.push(base);
							return expression;
						},
						effectiveWidth,
					);
					setPaint(layer.id, "line-width", preserveWidth ? original.paint["line-width"] : width);
					if (!preserveWidth) {
						if (setPaint(layer.id, "line-gap-color", satellite ? "rgba(0,0,0,0)" : "#000000")) {
							setPaint(layer.id, "line-gap-width", satellite ? 0 : 1);
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
		window.postMessage({ type: "KRB_MAP_STATUS", detail }, location.origin);
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
	let checkedRouteKey;
	let routeHighlightTimer;
	function routeSnapshot() {
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
		clearTimeout(routeHighlightTimer);
		if (map?.getLayer("krb-route-check-highlight")) map.removeLayer("krb-route-check-highlight");
		if (map?.getSource("krb-route-check-highlight")) map.removeSource("krb-route-check-highlight");
	}
	function checkRouteChanged() {
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
			window.postMessage({ type: "KRB_ROUTE_CHANGED" }, location.origin);
		}
	}
	window.addEventListener("message", function (event) {
		if (event.source !== window || event.origin !== location.origin) return;
		if (event.data?.type === "KRB_ROUTE_SNAPSHOT") {
			try {
				const snapshot = routeSnapshot();
				checkedRouteKey = snapshot.routeKey;
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
		if (event.data?.type === "KRB_ROUTE_FOCUS" && map) {
			checkRouteChanged();
			if (!checkedRouteKey || event.data.routeKey !== checkedRouteKey) return;
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
			clearRouteHighlight();
			try {
				map.addSource("krb-route-check-highlight", {
					type: "geojson",
					data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } },
				});
				map.addLayer({
					id: "krb-route-check-highlight",
					source: "krb-route-check-highlight",
					type: "line",
					paint: { "line-color": "#ff00bb", "line-width": 8, "line-opacity": 0.8 },
				});
				map.easeTo({ center: point, zoom: Math.max(map.getZoom(), 16), duration: 600 });
				routeHighlightTimer = setTimeout(clearRouteHighlight, 8000);
			}
			catch (error) {
				console.warn("Could not focus route warning:", error);
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
			event.data?.type !== "KRB_MAP_CONFIG"
		)
			return;
		const incoming = event.data.config;
		if (!incoming || !/^S[0-5]$/.test(incoming.maximumTrailLevel) || !incoming.rules) return;
		config = incoming;
		if (latestHazardStatus) window.postMessage(latestHazardStatus, location.origin);
		searchAttempts = 0;
		scheduleApply();
	});

	setInterval(function () {
		if (map && !document.contains(map.getCanvas())) {
			if (checkedRouteKey) window.postMessage({ type: "KRB_ROUTE_CHANGED" }, location.origin);
			checkedRouteKey = undefined;
			clearRouteHighlight();
			map.off("styledata", scheduleApply);
			map.off("idle", scheduleApply);
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
			squadratsOrder.clear();
			searchAttempts = 0;
		}
		if (map || ++searchAttempts > 30) return;
		const found = findMap();
		if (!found) return;
		map = found;

		map.on("styledata", scheduleApply);
		map.on("idle", scheduleApply);
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
