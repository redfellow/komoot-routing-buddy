(function () {
	const originals = new Map();
	const squadratsOriginals = new Map();
	const colours = ["#26a269", "#1c9cc5", "#6c63ff", "#f6a609", "#e66b2e", "#c01c28"];
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
		while (contrast(adjusted) < 7) adjusted = adjusted.map((channel) => Math.ceil(channel + (255 - channel) * 0.05));
		return "#" + adjusted.map((channel) => channel.toString(16).padStart(2, "0")).join("");
	}

	function isMap(value) {
		return value && typeof value.getStyle === "function" && typeof value.getCanvas === "function" &&
			typeof value.setPaintProperty === "function" && document.contains(value.getCanvas());
	}

	function findMap() {
		const queue = [];
		for (const canvas of document.querySelectorAll("canvas.maplibregl-canvas, canvas.mapboxgl-canvas")) {
			for (let element = canvas; element; element = element.parentElement) {
				for (const key of Object.getOwnPropertyNames(element)) {
					if (key.startsWith("__reactFiber$") || key.startsWith("__reactProps$")) queue.push(element[key]);
				}
			}
		}
		const seen = new Set();
		for (let index = 0; index < queue.length && index < 100000; index++) {
			const value = queue[index];
			if (!value || typeof value !== "object" || seen.has(value) || value instanceof Node || value === window) continue;
			seen.add(value);
			if (isMap(value)) return value;
			// Read data descriptors only: never invoke arbitrary React/browser getters.
			for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
				if (descriptor.value && typeof descriptor.value === "object" && queue.length < 100000) queue.push(descriptor.value);
			}
		}
		return null;
	}

	//check map properties dynamically mmkay.
	function levelExpression(nativeMtb = false) {
		const value = [
			"to-string",
			["coalesce",
				["get", "mtb_scale"],
				["get", "sac_scale"],
				["get", "trail_difficulty"],
				"none"
			]
		];
		const expression = ["match", nativeMtb ? ["to-string", ["get", "mtb_scale"]] : value];
		//store the values
		for (let level = 0; level <= 5; level++) {
			expression.push([String(level), `${level}+`, `${level}-`, `S${level}`, `s${level}`, `T${level}`, `t${level}`], level);
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
			return value.map((entry, index) => index >= 4 && index % 2 === 0 ? transform(entry) : entry);
		}
		if (Array.isArray(value) && value[0] === "step" && value[1]?.[0] === "zoom") {
			return value.map((entry, index) => index >= 2 && index % 2 === 0 ? transform(entry) : entry);
		}
		return transform(value ?? fallback);
	}

	function same(left, right) {
		return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
	}

	function setFilter(id, value) {
		if (!same(map.getFilter(id), value)) map.setFilter(id, value ?? null);
	}

	function setPaint(id, property, value) {
		if (!same(map.getPaintProperty(id, property), value)) map.setPaintProperty(id, property, value ?? null);
	}

	function restore(keep = new Set()) {
		for (const [id, original] of originals) {
			if (keep.has(id)) continue;
			originals.delete(id);
			if (map.getLayer(id) !== original.layer) continue;
			setFilter(id, original.filter);
			for (const [property, value] of Object.entries(original.paint)) setPaint(id, property, value);
		}
	}

	function applySquadrats() {
		const percent = Number.isFinite(config.squadratsOpacity) ? Math.max(0, Math.min(100, config.squadratsOpacity)) : 100;
		const sources = new Set(["squadrats-source", "squadrats-new-squadrats", "squadrats-new-squadratinhos", "squadrats-grid", "squadrats-gridinho"]);
		const layers = (map.getStyle()?.layers || []).filter((layer) =>
			layer.id.startsWith("squadrats-") && sources.has(layer.source) && ["fill", "line"].includes(layer.type));
		const ids = new Set(layers.map((layer) => layer.id));
		for (const id of squadratsOriginals.keys()) if (!ids.has(id)) squadratsOriginals.delete(id);
		for (const layer of layers) {
			const property = `${layer.type}-opacity`;
			const live = map.getLayer(layer.id);
			const current = map.getPaintProperty(layer.id, property);
			let original = squadratsOriginals.get(layer.id);
			if (!original || original.layer !== live) {
				original = { layer: live, value: structuredClone(current), applied: structuredClone(current) };
				squadratsOriginals.set(layer.id, original);
			}
			else if (!same(current, original.applied)) {
				if (same(current, original.value)) original.applied = structuredClone(current);
				else {
					original.value = structuredClone(current);
					original.applied = structuredClone(current);
				}
			}
			const value = percent === 100 ? original.value : transformStops(original.value, (base) => ["*", base, percent / 100], 1);
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
			return value.some((entry, index) => index >= 4 && index % 2 === 0 && canSeparateStrokes(entry));
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
		return ["line-gap-width", "line-offset"].some((property) =>
			canSeparateStrokes(map.getPaintProperty(id, property)));
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
				image.onload = function () { hazardIconAtlas = image; scheduleApply(); };
				image.onerror = function () { console.warn("KRB hazard icons could not load"); };
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
	const hazardIds = ["krb-conditions-line", "krb-conditions-point", "krb-conditions-label", "krb-conditions-trail-icons", ...hazardCategories.flatMap((key) => [`krb-conditions-icon-point-${key}`, `krb-conditions-icon-line-${key}`])];
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
		const feature = features.find((item) => item.layer?.id?.startsWith("krb-conditions-icon-")) || features[0];
		if (!feature) return hideHazardTooltip();
		const rect = map.getCanvas().getBoundingClientRect();
		window.postMessage({ type: "KRB_HAZARD_TOOLTIP", text: feature.layer?.id?.startsWith("krb-conditions-icon-") ? feature.properties[`tip_${feature.layer.id.split("-").at(-1)}`] : feature.properties.label,
			x: rect.left + event.point.x, y: rect.top + event.point.y }, location.origin);
	}
	function removeHazards() {
		hideHazardTooltip();
		for (const id of [...hazardIds].reverse()) if (map.getLayer(id)) map.removeLayer(id);
		if (map.getSource?.("krb-conditions")) map.removeSource("krb-conditions");
	}
	function drawHazards() {
		if (!hazardEnabled || !hazardData || !map.addSource) return;
		if (!map.getSource("krb-conditions")) map.addSource("krb-conditions", { type: "geojson", data: hazardData, attribution: "© OpenStreetMap contributors" });
		// Use a font served by the host style. MapLibre's default Open Sans stack
		// returns 403 on Komoot and can leave every tile of this source blank.
		const font = (map.getStyle()?.layers || [])
			.filter((layer) => layer.type === "symbol" && !layer.id.startsWith("krb-conditions"))
			.map((layer) => layer.layout?.["text-font"])
			.find((value) => Array.isArray(value) && value.length > 0 && value.every((name) => typeof name === "string") &&
				!["case", "match", "step", "interpolate", "get", "literal"].includes(value[0]));
		const style = map.getStyle();
		const satellite = (style?.layers || []).some((layer) =>
			layer.type === "raster" && layer.layout?.visibility !== "none" &&
			layer.paint?.["raster-opacity"] !== 0 &&
			/satellite|aerial|imagery/i.test(JSON.stringify([layer.id, layer.source, style.sources?.[layer.source]])));
		const widthPaint = { "text-color": satellite ? "#fff1cf" : "#000000", "text-halo-color": satellite ? "#222222" : "#ffffff", "text-halo-width": 1 };
		const iconsReady = installHazardIcons();
		const layers = [
			{ id: hazardIds[0], type: "line", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#e89416", "line-width": 2, "line-dasharray": [1, 3] } },
			{ id: hazardIds[2], type: "symbol", filter: ["all", ["==", ["geometry-type"], "LineString"], ["!=", ["get", "trailRating"], ""], ["!=", ["get", "widthLabel"], ""]], layout: { "text-font": font, "symbol-placement": "line", "text-field": ["get", "widthLabel"], "text-size": 12, "text-offset": [0, 1.5] }, paint: widthPaint }
		];
		for (const category of hazardCategories) {
			for (const [kind, geometry] of [["point", "Point"], ["line", "LineString"]]) {
				layers.push({ id: `krb-conditions-icon-${kind}-${category}`, type: "symbol",
					filter: ["all", ["==", ["geometry-type"], geometry], ["==", ["get", `icon_${category}`], true]],
					layout: { "symbol-placement": kind === "line" ? "line" : "point", "symbol-spacing": 280,
						"icon-image": `krb-hazard-${category}`, "icon-size": 0.85,
						"icon-offset": ["match", ["get", `offset_${category}`], ...[-45, -30, -15, 15, 30, 45].flatMap((offset) => [offset, ["literal", [offset, 0]]]), ["literal", [0, 0]]],
						"icon-rotation-alignment": "viewport", "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-padding": 0 }
				});
			}
		}
		// Without a usable host font, keep geometry visible and defer labels.
		for (const layer of layers) if ((layer.id === hazardIds[2] ? Boolean(font) : layer.type !== "symbol" || iconsReady) && !map.getLayer(layer.id)) map.addLayer({ ...layer, source: "krb-conditions", minzoom: 14 });
		if (map.getLayer(hazardIds[2])) {
			for (const [property, value] of Object.entries(widthPaint)) {
				if (map.getPaintProperty(hazardIds[2], property) !== value) map.setPaintProperty(hazardIds[2], property, value);
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
			hazardKey = undefined; hazardData = undefined; removeHazards();
			hazardStatus("Hazards: zoom in to load"); return;
		}
		const b = map.getBounds();
		const bounds = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
		const key = bounds.map((value) => value.toFixed(4)).join(",");
		if (key === hazardKey) { drawHazards(); return; }
		hazardKey = key;
		hazardData = undefined;
		removeHazards();
		hazardStatus("Loading OSM hazards…", "loading");
		window.postMessage({ type: "KRB_HAZARD_VIEW", bounds, requestId: hazardRequest }, location.origin);
	}
	window.addEventListener("message", function (event) {
		if (event.source !== window || event.origin !== location.origin || event.data?.type !== "KRB_HAZARD_DATA") return;
		if (!map || !hazardEnabled || event.data.requestId !== hazardRequest) return;
		if (event.data.error) {
			hazardKey = undefined;
			const retryMs = event.data.retryMs;
			const state = [429, 504].includes(event.data.status) ? "throttled" : "error";
			if (Number.isFinite(retryMs) && retryMs > 0 && !event.data.exhausted && hazardRetries < 3) {
				hazardRetries++;
				const delay = Math.max(30000, Math.min(300000, retryMs));
				hazardStatus(`Hazards: ${event.data.error}. Retrying in ${Math.ceil(delay / 1000)}s (${hazardRetries}/3)`, state);
				clearTimeout(hazardTimer);
				hazardTimer = setTimeout(updateHazards, delay);
			}
			else hazardStatus(`Hazards: ${event.data.error}. Move the map or toggle hazards to retry.`, state);
			return;
		}
		const data = event.data.data;
		if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) return;
		hazardRetries = 0;
		hazardData = data;
		drawHazards();
		const counts = data.counts || { total: 0, mud: 0, vegetation: 0, narrow: 0, other: 0 };
		hazardStatus(`${counts.total} hazards in cached area: ${counts.mud} muddy, ${counts.vegetation} vegetation, ${counts.narrow} narrow (<1 m), ${counts.other} obstacle/warning features. Categories may overlap. ${data.features.length} features including width data.`, "finished", counts);
	});

	function apply() {
		if (!map || !config || applying) return;
		applying = true;
		try {
			applySquadrats();
			const hazardsAllowed = config.showHazards === true && config.visualsEnabled !== false;
			if (hazardEnabled !== hazardsAllowed) {
				hazardEnabled = hazardsAllowed;
				hazardKey = undefined;
				hazardRequest++;
				if (hazardEnabled) scheduleHazards();
				else { hazardData = undefined; removeHazards(); hazardStatus(""); }
			}
			drawHazards();
			if (config.visualsEnabled === false) {
				restore();
				postStatus({ ready: true, enabled: false });
				return;
			}

			const styleLayers = (map.getStyle()?.layers || []).filter((layer) => !layer.id.startsWith("krb-conditions"));
			// Ignore zoom limits: a selected MTB overlay should retain its native
			// zoom behaviour rather than falling back to wider paths when zoomed out.
			const nativeLayers = styleLayers.filter((layer) =>
				/mtb/i.test(layer.id) && ["line", "symbol"].includes(layer.type) &&
				JSON.stringify([layer.filter, layer.layout]).includes('"mtb_scale"'));
			// Difficulty labels remain visible even with the sport overlay off.
			const nativeMtb = nativeLayers.some((layer) => layer.type === "line" && layer.layout?.visibility !== "none");
			const layers = nativeMtb ? nativeLayers : styleLayers.filter((layer) =>
				(!nativeLayers.includes(layer) || layer.type === "symbol") && ["line", "symbol"].includes(layer.type) &&
				(/"(mtb_scale|sac_scale|trail_difficulty)"/.test(JSON.stringify([layer.filter, layer.layout])) ||
					/(path|track|footway|cycleway|trail|steps)/i.test(layer.id)));
			// Undo the previous renderer before applying the newly selected one.
			// This also drops backups for removed/replaced style layers.
			restore(new Set(layers.map((layer) => layer.id)));
			const level = levelExpression(nativeMtb);
			const max = Number(config.maximumTrailLevel.slice(1));
			const applied = [];

			for (const layer of layers) {
				const liveLayer = map.getLayer(layer.id);
				const colourProperty = layer.type === "line" ? "line-color" : "text-color";
				const opacityProperty = layer.type === "line" ? "line-opacity" : "text-opacity";
				if (!originals.has(layer.id) || originals.get(layer.id).layer !== liveLayer) {
					const paintBackup = {
						[colourProperty]: structuredClone(map.getPaintProperty(layer.id, colourProperty)),
						[opacityProperty]: structuredClone(map.getPaintProperty(layer.id, opacityProperty))
					};
					//line width property
					if (layer.type === "line") {
						paintBackup["line-width"] = structuredClone(map.getPaintProperty(layer.id, "line-width"));
					}

					originals.set(layer.id, {
						layer: liveLayer,
						filter: structuredClone(map.getFilter(layer.id)),
						paint: paintBackup
					});
				}
				const original = originals.get(layer.id);
				if (layer.type === "symbol" && !("text-halo-color" in original.paint)) {
					for (const property of ["text-halo-color", "text-halo-width", "text-halo-blur"]) {
						original.paint[property] = structuredClone(map.getPaintProperty(layer.id, property));
					}
				}
				const allowed = ["any", ["==", level, -1], ["<=", level, max]];
				setFilter(layer.id, original.filter ? ["all", original.filter, allowed] : allowed);
				const colour = transformStops(original.paint[colourProperty], function (base) {
					const expression = ["match", level];
					for (let index = 0; index <= 5; index++) {
						const mode = config.rules[`S${index}`];
						const custom = config.colours?.[`S${index}`];
						const colour = /^#[0-9a-f]{6}$/i.test(custom) ? custom : colours[index];
						const selected = mode === "avoid" ? "#7a1016" : colour;
						expression.push(index, mode === "off" ? base : layer.type === "symbol" ? labelColour(selected) : selected);
					}
					expression.push(base);
					return expression;
				}, "#000000");
				const opacity = transformStops(original.paint[opacityProperty], function (base) {
					const expression = ["match", level];
					for (let index = 0; index <= 5; index++) expression.push(index, config.rules[`S${index}`] === "off" ? 0.2 : 1);
					expression.push(1);
					return ["*", base, expression];
				}, 1);
				setPaint(layer.id, colourProperty, colour);
				setPaint(layer.id, opacityProperty, opacity);
				if (layer.type === "symbol") {
					for (const [property, value, fallback] of [
						["text-halo-color", "#000000", "rgba(0,0,0,0)"],
						["text-halo-width", 0.5, 0],
						["text-halo-blur", 0, 0]
					]) {
						setPaint(layer.id, property, transformStops(original.paint[property], function (base) {
							const expression = ["match", level];
							for (let index = 0; index <= 5; index++) expression.push(index, config.rules[`S${index}`] === "off" ? base : value);
							expression.push(base);
							return expression;
						}, fallback));
					}
				}
				// Widen simple trails without distorting casings or parallel strokes.
				if (layer.type === "line" && !nativeMtb) {
					const preserveWidth = hasSeparatedStrokes(layer.id);
					const targetWidth = config.trailWidth || 4; //enforcing fallback just in case.
					const width = transformStops(original.paint["line-width"], function (base) {
						const expression = ["match", level];
						// line width drawn
						for (let index = 0; index <= 5; index++) expression.push(index, ["max", base, targetWidth]);
						expression.push(base); // unrated trails keep their standard width
						return expression;
					}, targetWidth);
					setPaint(layer.id, "line-width", preserveWidth ? original.paint["line-width"] : width);
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
			const present = (map.getStyle()?.layers || []).some((layer) => layer.id.startsWith("squadrats-"));
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
		scheduled = setTimeout(function () { scheduled = undefined; apply(); }, 500);
	}

	window.addEventListener("message", function (event) {
		if (event.source !== window || event.origin !== location.origin || event.data?.type !== "KRB_MAP_CONFIG") return;
		const incoming = event.data.config;
		if (!incoming || !/^S[0-5]$/.test(incoming.maximumTrailLevel) || !incoming.rules) return;
		config = incoming;
		if (latestHazardStatus) window.postMessage(latestHazardStatus, location.origin);
		searchAttempts = 0;
		scheduleApply();
	});

	setInterval(function () {
		if (map && !document.contains(map.getCanvas())) {
			map.off("styledata", scheduleApply);
			map.off("idle", scheduleApply);
			map.off("sourcedata", onSquadratsSource);
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
			originals.clear();
			squadratsOriginals.clear();
			searchAttempts = 0;
		}
		if (map || ++searchAttempts > 30) return;
		const found = findMap();
		if (!found) return;
		map = found;

		//debug the map properties. use this to find the drawn line properties.
		/* remove comment to enable debug.
		map.on("click", function (event) {
			const features = map.queryRenderedFeatures(event.point);
			console.log("Clicked Map Features:", features.map(f => ({
				layer: f.layer.id,
				properties: f.properties
			})));
		});
		*/
		map.on("styledata", scheduleApply);
		map.on("idle", scheduleApply);
		map.on("sourcedata", onSquadratsSource);
		map.on("moveend", scheduleHazards);
		map.on("mousemove", showHazardTooltip);
		map.on("click", showHazardTooltip);
		map.on("movestart", hideHazardTooltip);
		map.getCanvas().addEventListener?.("mouseleave", hideHazardTooltip);
		postStatus({ ready: true });
		scheduleApply();
	}, 1000);
})();
