// Connect the Komoot page, floating controls and extension-owned settings/data APIs.
(function () {
	if (!/^\/(?:tour\/[^/]+\/(?:zoom|edit)|plan(?:\/.*)?)$/.test(location.pathname)) return;
	// Keyboard commands are serialised so rapid toggles cannot overwrite a saved view.
	(function () {
		const MAPS = Object.freeze(["Default", "NLS Map", "Satellite", "OpenStreetMap", "OpenCycleMap"]);
		const SPORTS = Object.freeze(["None", "Hiking", "Cycling", "MTB", "Sport map 5"]);
		class ShortcutError extends Error {
			constructor(message) {
				super(message);
				this.name = "ShortcutError";
			}
		}
		function command(event) {
			if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
			const key = event.key?.toLowerCase();
			for (const node of event.composedPath?.() || [event.target]) {
				if (node?.isContentEditable || node?.closest?.("input, textarea, select, [role=textbox], [role=combobox], [role=slider], [role=dialog], dialog, .krb-ride")) return;
				// Number/letter map commands still work after clicking a map or
				// floater button. Space must retain native button/link activation.
				if (key === " " && node?.closest?.("button, a, [role=button], [role=menuitem], [role=option], [role=tab], [role=switch], [role=checkbox], [role=radio], #krb-panel")) return;
			}
			if (key === " ") return { kind: "inspection" };
			if (/^[1-5]$/.test(key)) return { kind: "mapType", label: MAPS[Number(key) - 1] };
			const sport = "qwert".indexOf(key);
			if (key?.length === 1 && sport >= 0) return { kind: "sportMap", label: SPORTS[sport], index: sport };
		}
		function createController(adapter) {
			let snapshot, pending = Promise.resolve();
			async function restore() {
				if (!snapshot) return;
				// Keep the snapshot until all native controls have been restored successfully.
				await adapter.select(snapshot);
				adapter.inspect(false);
				snapshot = undefined;
				adapter.announce("Previous map view restored.");
			}
			async function execute(action) {
				if (action.kind === "inspection") {
					if (snapshot) return restore();
					snapshot = await adapter.snapshot();
					try {
						adapter.inspect(true);
						await adapter.select({ heatmap: "None", sportMap: "None", mapType: "Satellite" });
						adapter.announce("Satellite inspection. Press Space to restore your view.");
					}
					catch (error) {
						try { await restore(); }
						catch (restoreError) { console.warn("Map view restore needs another Space press:", restoreError.message); }
						throw error;
					}
				}
				else {
					await restore();
					const label = await adapter.select({ [action.kind]: action.label }, action);
					adapter.announce(`${typeof label === "string" ? label : action.label} selected.`);
				}
			}
			function handle(event) {
				const action = command(event);
				if (!action || !adapter.ready()) return false;
				event.preventDefault();
				event.stopImmediatePropagation();
				pending = pending.then(async function () {
						try {
						if (!adapter.ready()) return;
						adapter.announce(action.kind === "inspection" ? (snapshot ? "Restoring previous map view…" : "Preparing satellite inspection…") : `Switching to ${action.label}…`);
						await execute(action);
					}
					catch (error) { adapter.announce(error.message || "Map shortcut unavailable."); }
				});
				return true;
			}
			function suspend() {
				const operation = pending.then(restore);
				pending = operation.catch((error) => adapter.announce(error.message || "Could not restore the previous map view."));
				return operation;
			}
			return { handle, idle: () => pending, active: () => Boolean(snapshot), restore, suspend };
		}
		globalThis.KrbMapShortcuts = { MAPS, SPORTS, command, createController, ShortcutError };
	})();
	// End keyboard controller.
	const contentSettings = globalThis.KrbSettings;

	const AVOID_COLOUR = "#7a1016";
	const STYLE_ID = "krb-trail-style";
	let restoreTimer;
	let routePreloadGeneration = 0;
	let viewportRequests = 0;
	let routePreloadWork = Promise.resolve();
	let mapReady = false;
	let extensionEnabled = true;
	let squadratsAvailable = false;
	let routeCheckActive = false;
	function updatePanelReadiness() {
		const panel = document.querySelector("#krb-panel");
		if (!panel) return;
		panel.inert = !mapReady;
		panel.setAttribute("aria-busy", String(!mapReady));
		panel.classList.toggle("krb-panel--loading", !mapReady);
		globalThis.KrbOnboarding?.setReady(mapReady);
	}
	let layersRestoredThisLoad = false;
	let restoringLayers = false;

	function installMapBridge() {
		if (document.querySelector("#krb-map-bridge")) return;
		const roadReferences = document.createElement("script");
		roadReferences.src = globalThis.KrbBrowser.runtime.getURL("road-references-fi.js");
		roadReferences.async = false;
		(document.head || document.documentElement).append(roadReferences);
		const estimates = document.createElement("script");
		estimates.src = globalThis.KrbBrowser.runtime.getURL("squadrats-estimate.js");
		estimates.async = false;
		(document.head || document.documentElement).append(estimates);
		const insertion = document.createElement("script");
		insertion.src = globalThis.KrbBrowser.runtime.getURL("komoot-poi-insert.js");
		insertion.async = false;
		(document.head || document.documentElement).append(insertion);
		const script = document.createElement("script");
		script.async = false;
		script.id = "krb-map-bridge";
		script.dataset.hazardIcons = globalThis.KrbBrowser.runtime.getURL("hazard-icons.png");
		script.src = globalThis.KrbBrowser.runtime.getURL("map-bridge.js");
		script.addEventListener("load", () => refresh(false));
		(document.head || document.documentElement).append(script);
	}

	function sendMapConfig(rules, options, colours) {
		window.postMessage(
			{
				type: "KRB_MAP_CONFIG",
				config: {
					rules,
					colours,
					colourLabels: options.colourLabels === true,
					emphasizeRoadNumbers: options.emphasizeRoadNumbers === true,
					roadNumberMinZoom: options.roadNumberMinZoom,
					showHazards: options.showHazards,
					narrowWarningWidth: options.narrowWarningWidth,
					preloadRouteHazards: options.preloadRouteHazards === true,
					squadratsOpacity: options.squadratsOpacity,
					squadratsBelowRoads: options.squadratsBelowRoads !== false,
					estimateSquadrats: options.estimateSquadrats === true,
					visualsEnabled: options.visualsEnabled !== false,
					maximumTrailLevel: options.maximumTrailLevel,
				},
			},
			location.origin,
		);
	}

	window.addEventListener("message", async function (event) {
		if (event.source !== window || event.origin !== location.origin) return;
		if (event.data?.type === "KRB_ROUTE_CHECK_ACTIVE") {
			routeCheckActive = event.data.active === true;
			if (routeCheckActive) routePreloadGeneration++;
		}
		if (event.data?.type === "KRB_MAP_STATUS") {
			mapReady = event.data.detail?.ready === true && !event.data.detail?.error;
			squadratsAvailable = event.data.detail?.squadratsAvailable === true;
			document.querySelector(".krb-panel__settings-frame")?.contentWindow?.postMessage({ type: "KRB_SETTINGS_CONTEXT", squadratsAvailable }, globalThis.KrbBrowser.runtime.getURL("").replace(/\/$/, ""));
			updatePanelReadiness();
		}
		if (event.data?.type === "KRB_PRELOAD_ROUTE") {
			if (routeCheckActive) return;
			const generation = ++routePreloadGeneration;
			const areas = Array.isArray(event.data.areas) ? event.data.areas.slice(0, 8) : [];
			routePreloadWork = routePreloadWork
				.catch((error) => console.debug("OSM preload queue reset:", error.message))
				.then(async function () {
					for (const bounds of areas) {
						await new Promise((resolve) => setTimeout(resolve, 1500));
						while (viewportRequests && generation === routePreloadGeneration)
							await new Promise((resolve) => setTimeout(resolve, 250));
						if (generation !== routePreloadGeneration) return;
						const options = await contentSettings.getOptions();
						if (
							!options.preloadRouteHazards ||
							!options.showHazards ||
							options.visualsEnabled === false
						)
							return;
						try {
							const result = await globalThis.KrbBrowser.runtime.sendMessage({
								type: "KRB_LOAD_HAZARDS",
								bounds,
								prefetch: true,
							});
							if (result?.error) return; // Stop on failure; never hammer a throttled provider.
						}
						catch (error) {
							console.debug("OSM route preload stopped:", error.message);
							return;
						}
					}
				});
		}
		if (event.data?.type === "KRB_HAZARD_VIEW") {
			const { bounds, requestId } = event.data;
			const options = await contentSettings.getOptions();
			if (options.visualsEnabled === false || !options.showHazards) return;
			try {
				viewportRequests++;
				const result = await globalThis.KrbBrowser.runtime.sendMessage({
					type: "KRB_LOAD_HAZARDS",
					bounds,
				});
				window.postMessage({ type: "KRB_HAZARD_DATA", requestId, ...result }, location.origin);
			}
			catch (error) {
				window.postMessage(
					{ type: "KRB_HAZARD_DATA", requestId, error: error.message },
					location.origin,
				);
			}
			finally {
				viewportRequests--;
			}
		}
		if (event.data?.type === "KRB_HAZARD_TOOLTIP") {
			let tooltip = document.querySelector("#krb-hazard-tooltip");
			if (!tooltip) {
				tooltip = document.createElement("div");
				tooltip.id = "krb-hazard-tooltip";
				tooltip.className = "krb-panel__osm-tooltip";
				tooltip.setAttribute("role", "tooltip");
				document.documentElement.append(tooltip);
			}
			const { text, x, y } = event.data;
			tooltip.hidden = !text || !Number.isFinite(x) || !Number.isFinite(y);
			tooltip.textContent = String(text || "").slice(0, 400);
			if (!tooltip.hidden) {
				tooltip.style.left = `${Math.max(8, Math.min(x + 12, window.innerWidth - tooltip.offsetWidth - 8))}px`;
				tooltip.style.top = `${Math.max(8, Math.min(y + 12, window.innerHeight - tooltip.offsetHeight - 8))}px`;
			}
		}
		if (event.data?.type === "KRB_HAZARD_STATUS") renderHazardStatus(event.data);
	});

	let latestHazardStatus;
	function renderHazardStatus(data) {
		if (!extensionEnabled) data = { state: "idle", text: "" };
		latestHazardStatus = data;
		const panel = document.querySelector("#krb-panel");
		if (!panel) return;
		const indicator = panel.querySelector(".krb-panel__osm");
		const icons = { loading: "", finished: "✓", throttled: "", error: "!", idle: "—" };
		const state = Object.hasOwn(icons, data.state) ? data.state : "idle";
		indicator.dataset.state = state;
		indicator.hidden = data.text === "";
		const icon = indicator.querySelector(".krb-panel__osm-icon");
		if (state === "loading")
			icon.innerHTML =
				"<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M 20 12 A 8 8 0 1 1 12 4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3\" stroke-linecap=\"round\"/></svg>";
		else if (state === "throttled")
			icon.innerHTML =
				"<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"6\" y=\"1\" width=\"12\" height=\"22\" rx=\"4\" fill=\"#26312c\"/><circle cx=\"12\" cy=\"6\" r=\"3\" fill=\"#ff4545\" stroke=\"#ffaaaa\" stroke-width=\"0.7\"/><circle cx=\"12\" cy=\"12\" r=\"2.5\" fill=\"#555247\"/><circle cx=\"12\" cy=\"18\" r=\"2.5\" fill=\"#3b5045\"/></svg>";
		else icon.textContent = icons[state];
		const total = data.counts?.total;
		indicator.querySelector(".krb-panel__osm-count").textContent =
			Number.isInteger(total) && total >= 0 ? String(total) : "";
		indicator.dataset.tooltip = String(data.text || "OSM idle").slice(0, 600);
		indicator.setAttribute("aria-label", `OSM ${state}: ${indicator.dataset.tooltip}`);
		const tooltip = document.querySelector("#krb-osm-tooltip");
		if (tooltip) {
			tooltip.textContent = indicator.dataset.tooltip;
			if (indicator.hidden) tooltip.hidden = true;
		}
		let status = panel.querySelector(".krb-panel__hazards");
		if (!status) {
			status = document.createElement("div");
			status.className = "krb-panel__hazards";
			panel.append(status);
		}
		status.hidden = data.text === "";
		status.textContent =
			{ loading: "Loading OSM…", throttled: "OSM busy", error: "OSM unavailable" }[state] ||
			String(data.text || "").slice(0, 500);
		if (state === "error" || state === "throttled") {
			const retry = document.createElement("button");
			retry.type = "button";
			retry.className = "krb-panel__hazard-retry";
			retry.textContent = "Retry";
			retry.setAttribute("aria-label", "Retry loading OSM hazards");
			retry.addEventListener("click", function () {
				if (retry.disabled) return;
				retry.disabled = true;
				renderHazardStatus({ state: "loading", text: "Retrying OSM hazards…" });
				window.postMessage({ type: "KRB_RELOAD_HAZARDS" }, location.origin);
			});
			status.append(retry);
		}
		if (state === "finished" && data.counts) {
			const counts = data.counts;
			const count = (key) => (Number.isInteger(counts[key]) && counts[key] >= 0 ? counts[key] : 0);
			status.textContent = `${count("total")} hazards · Mud ${count("mud")} · Vegetation ${count("vegetation")} · Narrow ${count("narrow")} · Obstacles ${count("other")}`;
			const help = document.createElement("details");
			help.className = "krb-panel__hazard-help";
			const summary = document.createElement("summary");
			summary.textContent = "?";
			summary.setAttribute("aria-label", "About hazard counts");
			const explanation =
				"Counts cover the cached area. Narrow means under 1 metre. Obstacles includes warnings. Categories can overlap; the header counts each feature once. Missing OSM data means unknown conditions.";
			summary.title = explanation;
			const text = document.createElement("p");
			text.textContent = explanation;
			help.append(summary, text);
			status.append(help);
		}
		if (!status.hidden) {
			const credit = document.createElement("a");
			credit.href = "https://www.openstreetmap.org/copyright";
			credit.target = "_blank";
			credit.rel = "noopener noreferrer";
			credit.textContent = "© OpenStreetMap";
			credit.className = "krb-panel__hazard-credit";
			status.append(credit);
		}
	}

	function createPanel(state) {
		if (document.querySelector("#krb-panel")) return;
		const panel = document.createElement("details");
		panel.id = "krb-panel";
		panel.open = false;
		panel.innerHTML = `
			<summary>
				<span class="krb-panel__drag" aria-hidden="true">
					<i></i>
					<i></i>
					<i></i>
					<i></i>
					<i></i>
					<i></i>
				</span>
				<span class="krb-panel__title"><span class="krb-panel__title--compact">KRB</span><span class="krb-panel__title--expanded">Routing Buddy</span></span>
				<span
					class="krb-panel__osm"
					role="status"
					aria-label="OSM waiting"
					tabindex="0"
					data-tooltip="OSM waiting"
					aria-describedby="krb-osm-tooltip"
				>
					<span class="krb-panel__osm-icon">—</span>
					<span class="krb-panel__osm-count"></span>
				</span>
				<button
					type="button"
					class="krb-panel__toggle"
					role="switch"
					aria-checked="true"
					aria-label="Trail colours"
					title="Toggle trail colours"
				>
					On
				</button>
				<span class="krb-panel__tools"></span>
				<span class="krb-panel__caret" aria-hidden="true">⌄</span>
			</summary>
			<iframe class="krb-panel__settings-frame" title="Routing Buddy settings"></iframe>
		`;
		document.documentElement.append(panel);
		updatePanelReadiness();
		setupPanelControls(panel, state || {});
		mountPanelSettings(panel);
		globalThis.KrbRideDialog?.attach(panel);
		globalThis.KrbOnboarding?.attach(panel);
		globalThis.KrbOnboarding?.setReady(mapReady);
		setupOsmTooltip(panel);
		renderHazardStatus(latestHazardStatus || { state: "loading", text: "Connecting to OSM map…" });
	}

	function setupOsmTooltip(panel) {
		const indicator = panel.querySelector(".krb-panel__osm");
		const tooltip = document.createElement("div");
		tooltip.id = "krb-osm-tooltip";
		tooltip.className = "krb-panel__osm-tooltip";
		tooltip.setAttribute("role", "tooltip");
		tooltip.hidden = true;
		document.documentElement.append(tooltip);
		function show() {
			tooltip.textContent = indicator.dataset.tooltip;
			tooltip.hidden = false;
			const rect = indicator.getBoundingClientRect();
			tooltip.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - tooltip.offsetWidth - 8))}px`;
			tooltip.style.top = `${Math.max(8, rect.bottom + tooltip.offsetHeight + 8 <= window.innerHeight ? rect.bottom + 6 : rect.top - tooltip.offsetHeight - 6)}px`;
		}
		function hide() {
			tooltip.hidden = true;
		}
		indicator.addEventListener("pointerenter", show);
		indicator.addEventListener("pointerleave", hide);
		indicator.addEventListener("focus", show);
		indicator.addEventListener("blur", hide);
		indicator.addEventListener("keydown", function (event) {
			if (event.key === "Escape") {
				hide();
				event.stopPropagation();
			}
		});
		window.addEventListener("resize", hide);
		panel.querySelector("summary").addEventListener("pointerdown", hide);
	}

	function mountPanelSettings(panel) {
		const frame = panel.querySelector(".krb-panel__settings-frame");
		frame.src = globalThis.KrbBrowser.runtime.getURL("popup.html");
		const settingsOrigin = globalThis.KrbBrowser.runtime.getURL("").replace(/\/$/, "");
		function sendContext() {
			frame.contentWindow?.postMessage({ type: "KRB_SETTINGS_CONTEXT", squadratsAvailable }, settingsOrigin);
		}
		frame.addEventListener("load", sendContext);
		window.addEventListener("message", function (event) {
			if (event.source !== frame.contentWindow || event.origin !== settingsOrigin) return;
			if (event.data?.type === "KRB_SETTINGS_SIZE" && Number.isFinite(event.data.height)) {
				frame.style.height = `${Math.max(120, Math.min(event.data.height + 12, window.innerHeight - 150))}px`;
			}
			else if (event.data?.type === "KRB_CLOSE_SETTINGS") panel.open = false;
			else if (event.data?.type === "KRB_SHOW_GUIDE") {
				panel.open = false;
				globalThis.KrbOnboarding?.show();
			}
		});
	}

	function setupPanelControls(panel, state = {}) {
		const header = panel.querySelector("summary");
		const toggle = panel.querySelector(".krb-panel__toggle");
		toggle.addEventListener("click", async function (event) {
			event.preventDefault();
			event.stopPropagation();
			toggle.disabled = true;
			try {
				const options = await contentSettings.getOptions();
				await globalThis.KrbBrowser.storage.sync.set({
					trailVisualsEnabled: options.visualsEnabled === false,
				});
				await refresh(false);
			}
			catch (error) {
				console.error("Routing Buddy could not toggle visuals:", error);
			}
			finally {
				toggle.disabled = false;
			}
		});
		let drag;
		let suppressClick = false;

		function movePanel(left, top) {
			panel.style.right = "auto";
			panel.style.left = `${Math.max(0, Math.min(left, window.innerWidth - panel.offsetWidth))}px`;
			panel.style.top = `${Math.max(0, Math.min(top, window.innerHeight - panel.offsetHeight))}px`;
		}

		let lastOpen = panel.open;
		let position = state.position;
		let pendingSave = Promise.resolve();
		function savePanelState() {
			const panelState = { open: panel.open, position };
			pendingSave = pendingSave
				.then(function () {
					return globalThis.KrbBrowser.storage.local.set({ panelState });
				})
				.catch(function (error) {
					console.error("Routing Buddy could not save panel state:", error);
				});
		}
		if (Number.isFinite(position?.left) && Number.isFinite(position?.top)) {
			movePanel(position.left, position.top);
		}

		header.addEventListener("pointerdown", function (event) {
			if (event.button !== 0 || event.target.closest("button")) return;
			const rect = panel.getBoundingClientRect();
			suppressClick = false;
			drag = {
				id: event.pointerId,
				x: event.clientX,
				y: event.clientY,
				left: rect.left,
				top: rect.top,
			};
			header.setPointerCapture(event.pointerId);
		});
		header.addEventListener("pointermove", function (event) {
			if (!drag || drag.id !== event.pointerId) return;
			const dx = event.clientX - drag.x;
			const dy = event.clientY - drag.y;
			if (!suppressClick && Math.hypot(dx, dy) < 5) return;
			suppressClick = true;
			movePanel(drag.left + dx, drag.top + dy);
		});
		function finishDrag() {
			if (drag && suppressClick) {
				const rect = panel.getBoundingClientRect();
				position = { left: rect.left, top: rect.top };
				savePanelState();
			}
			drag = undefined;
		}
		header.addEventListener("pointerup", finishDrag);
		header.addEventListener("pointercancel", finishDrag);
		header.addEventListener("lostpointercapture", finishDrag);
		header.addEventListener("click", function (event) {
			if (suppressClick && event.detail !== 0) {
				event.preventDefault();
				suppressClick = false;
			}
		});
		window.addEventListener("resize", function () {
			const rect = panel.getBoundingClientRect();
			movePanel(rect.left, rect.top);
		});
		panel.addEventListener("toggle", function () {
			if (panel.open !== lastOpen) {
				lastOpen = panel.open;
				savePanelState();
			}
			const rect = panel.getBoundingClientRect();
			movePanel(rect.left, rect.top);
		});
	}

	function difficultySelector(level) {
		const lower = level.toLowerCase();
		return [
			`[data-mtb-difficulty="${level}"]`,
			`[data-mtb-difficulty="${lower}"]`,
			`[data-trail-difficulty="${level}"]`,
			`[data-trail-difficulty="${lower}"]`,
			`[data-sac-scale="${level}"]`,
			`[class~="mtb-${lower}"]`,
			`[class~="difficulty-${lower}"]`,
			`[class~="${lower}"]`,
		].join(", ");
	}

	function applyTrailStyles(rules, maximumTrailLevel) {
		let css = "";
		for (const level of contentSettings.LEVELS) {
			const selector = difficultySelector(level);
			const rule =
				contentSettings.LEVELS.indexOf(level) > contentSettings.LEVELS.indexOf(maximumTrailLevel)
					? "off"
					: rules[level];
			if (rule === "off") css += `${selector}{opacity:.2 !important;}`;
			else {
				const colour = rule === "avoid" ? AVOID_COLOUR : contentSettings.HIGHLIGHT_COLOURS[level];
				css += `${selector}{stroke:${colour} !important;fill:${colour} !important;color:${colour} !important;opacity:1 !important;}`;
			}
		}
		// MapLibre renders Komoot trail pixels in WebGL; CSS cannot alter them.
		// The page-world bridge applies the equivalent rules to MapLibre layers.
	}

	function renderLegend(rules, maximumTrailLevel, colours) {
		const legend = document.querySelector("#krb-panel .krb-panel__legend");
		if (!legend) return;
		legend.replaceChildren(
			...contentSettings.LEVELS.map(function (level) {
				const mode =
					contentSettings.LEVELS.indexOf(level) > contentSettings.LEVELS.indexOf(maximumTrailLevel)
						? "off"
						: rules[level];
				const item = document.createElement("div");
				item.className = `krb-panel__level ${mode === "off" ? "krb-panel__level--muted" : ""} ${mode === "avoid" ? "krb-panel__level--avoid" : ""}`;
				const dot = document.createElement("span");
				dot.className = "krb-panel__dot";
				dot.style.background = mode === "avoid" ? AVOID_COLOUR : colours[level];
				item.append(dot, document.createTextNode(level));
				return item;
			}),
		);
	}

	function layerKind(element) {
		const imageSource = element.querySelector("img[alt=\"map layer\"]")?.getAttribute("src") || "";
		if (imageSource.includes("baselayer-")) return "mapType";
		if (imageSource.includes("overlay-komoot-sport-specific-")) return "sportMap";
		if (imageSource.includes("heatmap-")) return "heatmap";
		return null;
	}

	function layerLabel(element) {
		return element.getAttribute("aria-label") || element.textContent?.trim() || "";
	}

	const HEATMAP_SPORTS = [
		"All sports",
		"All foot sports",
		"Hiking",
		"Running",
		"All riding sports",
		"Cycling",
		"Mountain biking",
		"Road cycling",
		"Gravel riding",
	];

	async function rememberHeatmapSport(event) {
		if (!extensionEnabled) return;
		if (restoringLayers || !document.body.innerText.includes("Heatmap settings")) return;
		let node = event.target;
		while (node && node !== document.body) {
			const label = node.textContent?.trim();
			if (HEATMAP_SPORTS.includes(label)) {
				const options = await contentSettings.getOptions();
				if (options.rememberLayers)
					await globalThis.KrbBrowser.storage.sync.set({
						trailOptions: {
							...options,
							rememberedLayers: { ...options.rememberedLayers, heatmapSport: label },
						},
					});
				return;
			}
			node = node.parentElement;
		}
	}

	async function rememberLayerClick(event) {
		if (!extensionEnabled) return;
		if (restoringLayers) return;
		const element = event.target.closest("button, [role=menuitem], [role=option], label");
		if (!element || element.closest("#krb-panel")) return;
		const kind = layerKind(element);
		const label = layerLabel(element);
		if (!kind || !label || label === "Layers") return;
		const options = await contentSettings.getOptions();
		if (!options.rememberLayers) return;
		await globalThis.KrbBrowser.storage.sync.set({
			trailOptions: {
				...options,
				rememberedLayers: { ...options.rememberedLayers, [kind]: label },
			},
		});
	}

	function findLayerMenuOpener() {
		const dataControlButton = document.querySelector("[data-control-layers-button] button");
		if (dataControlButton) return dataControlButton;
		return [...document.querySelectorAll("button")].find(function (element) {
			return (
				element.querySelector("img[alt=\"map layer\"]") && /layers/i.test(element.textContent || "")
			);
		});
	}

	function findLayerOption(kind, label) {
		return [...document.querySelectorAll("button[aria-label]")].find(function (element) {
			return layerKind(element) === kind && layerLabel(element) === label;
		});
	}

	function findHeatmapSport(label) {
		return [...document.querySelectorAll("p")].find(
			(element) => element.textContent?.trim() === label,
		);
	}

	function heatmapSportIsSelected(label) {
		let row = findHeatmapSport(label);
		// The radio is a sibling of the label block, four wrappers above the <p> in Komoot's sheet.
		for (let depth = 0; row && depth < 5; depth += 1, row = row.parentElement) {
			if (row.querySelector(":scope input[type=\"radio\"]:checked")) return true;
		}
		return false;
	}

	function hideRestorationSheets() {
		const hidden = new Set();
		function hideSheets() {
			for (const heading of document.querySelectorAll("p")) {
				if (!["Customize map", "Heatmap settings"].includes(heading.textContent?.trim())) continue;
				let sheet = heading.parentElement;
				while (sheet && sheet !== document.body && sheet !== document.documentElement) {
					// Stop before the map or application root; hide only the sheet containing its controls.
					if (sheet.querySelector("canvas")) break;
					if (
						sheet.querySelector("button[aria-label=\"Close\"]") &&
						sheet.querySelector("img[alt=\"map layer\"], input[type=\"radio\"]")
					) {
						sheet.classList.add("krb-restoration__sheet");
						hidden.add(sheet);
						break;
					}
					sheet = sheet.parentElement;
				}
			}
		}
		const observer = new MutationObserver(hideSheets);
		observer.observe(document.documentElement, { childList: true, subtree: true });
		hideSheets();
		return function () {
			observer.disconnect();
			for (const sheet of hidden) sheet.classList.remove("krb-restoration__sheet");
		};
	}

	function closeLayerSheetWhenAvailable(done) {
		let closeAttempts = 0;
		const closeTimer = window.setInterval(function () {
			closeAttempts += 1;
			const heading = [...document.querySelectorAll("p")].find(function (element) {
				return ["Customize map", "Heatmap settings"].includes(element.textContent?.trim());
			});
			const closeButton = heading?.parentElement?.querySelector(
				"button[aria-label=\"Close\"][aria-disabled=\"false\"]",
			);
			if (closeButton) {
				closeButton.click();
				window.clearInterval(closeTimer);
				// Keep the closing animation hidden too.
				window.setTimeout(done, 750);
			}
			else if (closeAttempts >= 15) {
				window.clearInterval(closeTimer);
				done();
			}
		}, 250);
	}

	async function restoreLayers(options) {
		if (!options.rememberLayers || layersRestoredThisLoad || restoringLayers) return;
		const layers = options.rememberedLayers || {};
		if (!Object.keys(layers).length) return;
		window.clearInterval(restoreTimer);
		restoringLayers = true;
		const revealSheets = hideRestorationSheets();
		let finishing = false;
		const restorationDeadline = window.setTimeout(function () {
			window.clearInterval(restoreTimer);
			revealSheets();
			restoringLayers = false;
		}, 16000);
		let attempts = 0;
		let layerSheetOpened = false;
		let step = "heatmap";
		const finishRestore = function () {
			if (finishing) return;
			finishing = true;
			window.clearInterval(restoreTimer);
			closeLayerSheetWhenAvailable(function () {
				window.clearTimeout(restorationDeadline);
				revealSheets();
				restoringLayers = false;
			});
		};
		restoreTimer = window.setInterval(function () {
			attempts += 1;
			if (attempts > 30) {
				finishRestore();
				return;
			}
			const opener = findLayerMenuOpener();
			if (!opener) {
				if (attempts >= 30) finishRestore();
				return;
			}

			const ensureLayerSheet = function (kind) {
				const option = findLayerOption(kind, layers[kind]);
				if (!option && !layerSheetOpened) {
					opener.click();
					layerSheetOpened = true;
				}
				return option;
			};
			if (step === "heatmap") {
				if (!layers.heatmap) {
					step = "sportMap";
					return;
				}
				const option = ensureLayerSheet("heatmap");
				if (!option) return;
				if (!option.classList.contains("selected")) option.click();
				step = layers.heatmapSport && layers.heatmap !== "None" ? "heatmapSport" : "reopenLayers";
				layerSheetOpened = false;
				return;
			}
			if (step === "heatmapSport") {
				const sport = findHeatmapSport(layers.heatmapSport);
				if (!sport) return;
				if (!heatmapSportIsSelected(layers.heatmapSport)) sport.click();
				step = "reopenLayers";
				return;
			}
			if (step === "reopenLayers") {
				opener.click();
				layerSheetOpened = true;
				step = "sportMap";
				return;
			}
			if (step === "sportMap") {
				if (!layers.sportMap) {
					step = "mapType";
					return;
				}
				const option = ensureLayerSheet("sportMap");
				if (!option) return;
				if (!option.classList.contains("selected")) option.click();
				step = "mapType";
				return;
			}
			if (step === "mapType") {
				if (!layers.mapType) {
					layersRestoredThisLoad = true;
					finishRestore();
					return;
				}
				const option = ensureLayerSheet("mapType");
				if (!option) return;
				if (!option.classList.contains("selected")) option.click();
				layersRestoredThisLoad = true;
				finishRestore();
			}
			else if (attempts >= 30) {
				finishRestore();
			}
		}, 350);
	}

	async function shortcutWait(find, timeout = 4000) {
		const deadline = Date.now() + timeout;
		while (Date.now() < deadline) {
			const result = find();
			if (result) return result;
			await new Promise((resolve) => window.setTimeout(resolve, 100));
		}
		throw new globalThis.KrbMapShortcuts.ShortcutError("Komoot map controls are unavailable. Try again when the map has loaded.");
	}
	function selectedLayer(kind) {
		return [...document.querySelectorAll("button[aria-label]")].find(function (button) {
			return layerKind(button) === kind && (button.classList.contains("selected") || button.getAttribute("aria-pressed") === "true" || button.getAttribute("aria-checked") === "true");
		});
	}
	async function shortcutLayerSheet() {
		if (findLayerOption("mapType", "Default")) return;
		const opener = findLayerMenuOpener();
		if (!opener) throw new globalThis.KrbMapShortcuts.ShortcutError("Open the Komoot map to use map shortcuts.");
		opener.click();
		await shortcutWait(() => findLayerOption("mapType", "Default"));
	}
	async function withShortcutLayers(operation) {
		await shortcutWait(() => !restoringLayers, 18000);
		restoringLayers = true;
		const reveal = hideRestorationSheets(), focus = document.activeElement;
		try {
			await shortcutLayerSheet();
			return await operation();
		}
		finally {
			await new Promise((resolve) => closeLayerSheetWhenAvailable(resolve));
			reveal();
			restoringLayers = false;
			if (focus?.isConnected && !focus.closest?.(".krb-restoration__sheet")) focus.focus?.({ preventScroll: true });
		}
	}
	function announceShortcut(text) {
		let status = document.getElementById("krb-shortcut-status");
		if (!status) {
			status = document.createElement("div");
			status.id = "krb-shortcut-status";
			status.className = "krb-shortcut__status";
			status.setAttribute("role", "status");
			status.setAttribute("aria-live", "polite");
			document.documentElement.append(status);
		}
		status.textContent = text;
		window.clearTimeout(announceShortcut.timer);
		announceShortcut.timer = window.setTimeout(function () { status.textContent = ""; }, 3500);
	}
	const mapShortcuts = globalThis.KrbMapShortcuts?.createController({
		ready() {
			return /^\/(?:tour\/[^/]+\/(?:zoom|edit)|plan(?:\/.*)?)$/.test(location.pathname) && mapReady && extensionEnabled && !document.querySelector("#krb-panel[open]") &&
				!document.querySelector("dialog[open], [aria-modal=true]:not([hidden])");
		},
		async snapshot() {
			return withShortcutLayers(function () {
				const state = {};
				for (const kind of ["mapType", "sportMap", "heatmap"]) {
					const selected = selectedLayer(kind);
					if (!selected) throw new globalThis.KrbMapShortcuts.ShortcutError("Could not read the current map choices; satellite inspection was not started.");
					state[kind] = layerLabel(selected);
				}
				return state;
			});
		},
		async select(state, action) {
			let chosenLabel;
			const chosen = {};
			await withShortcutLayers(async function () {
				for (const kind of ["heatmap", "sportMap", "mapType"]) {
					if (!state[kind]) continue;
					await shortcutLayerSheet();
					let option = findLayerOption(kind, state[kind]);
					if (action?.kind === "sportMap" && Number.isInteger(action.index)) {
						option = [...document.querySelectorAll("button[aria-label]")].filter((button) => layerKind(button) === "sportMap")[action.index];
					}
					if (!option || option.disabled || option.getAttribute("aria-disabled") === "true")
						throw new globalThis.KrbMapShortcuts.ShortcutError(`${state[kind]} is not available for this map or account.`);
					const label = layerLabel(option);
					chosen[kind] = label;
					chosenLabel = label;
					if (selectedLayer(kind) === option) continue;
					option.click();
					// Heatmap selection can open its settings sheet. Return to the layer chooser.
					if (kind === "heatmap" && label !== "None") {
						await shortcutWait(() => !option.isConnected || findHeatmapSport("All sports"));
						await shortcutLayerSheet();
					}
					await shortcutWait(() => selectedLayer(kind) && layerLabel(selectedLayer(kind)) === label);
				}
			});
			if (action) {
				const options = await contentSettings.getOptions();
				if (options.rememberLayers) await globalThis.KrbBrowser.storage.sync.set({ trailOptions: {
					...options, rememberedLayers: { ...options.rememberedLayers, ...chosen },
				} });
			}
			return chosenLabel;
		},
		inspect(active) {
			window.postMessage({ type: "KRB_INSPECTION_MODE", active }, location.origin);
		},
		announce: announceShortcut,
	});
	window.addEventListener("keydown", function (event) { mapShortcuts?.handle(event); }, true);


	async function refresh(shouldRestore = false, previewColours, squadratsOpacity) {
		const [rules, options, savedColours] = await Promise.all([
			contentSettings.getRules(),
			contentSettings.getOptions(),
			contentSettings.getColours(),
		]);
		if (Number.isFinite(squadratsOpacity)) options.squadratsOpacity = squadratsOpacity;
		const colours = previewColours || savedColours;
		const { panelState } = await globalThis.KrbBrowser.storage.local.get("panelState");
		createPanel(panelState);
		renderLegend(rules, options.maximumTrailLevel, colours);
		const panel = document.querySelector("#krb-panel");
		const enabled = options.visualsEnabled !== false;
		extensionEnabled = enabled;
		globalThis.KrbExtensionEnabled = enabled;
		const analyseButton = panel.querySelector(".krb-panel__analyse");
		if (analyseButton) analyseButton.disabled = !enabled;
		if (!enabled) {
			globalThis.KrbRideDialog?.suspend();
			routePreloadGeneration++;
		}
		const toggle = panel.querySelector(".krb-panel__toggle");
		toggle.setAttribute("aria-checked", String(enabled));
		toggle.textContent = enabled ? "On" : "Off";
		panel.classList.toggle("krb-panel--disabled", !enabled);
		if (!enabled) document.getElementById(STYLE_ID)?.remove();
		if (!enabled || !options.showHazards) renderHazardStatus({ state: "idle", text: "" });
		else if (!latestHazardStatus?.text)
			renderHazardStatus({ state: "loading", text: "Connecting to OSM map…" });
		sendMapConfig(rules, options, colours);
		if (!enabled) {
			try { await mapShortcuts?.suspend(); }
			catch (error) { console.warn("Could not restore the previous map selection:", error.message); }
		}
		if (enabled && shouldRestore) restoreLayers(options);
	}

	globalThis.KrbBrowser.runtime.onMessage.addListener(function (message, sender, sendResponse) {
		if (sender.id === globalThis.KrbBrowser.runtime.id && message?.type === "KRB_GET_MAP_CONTEXT") {
			sendResponse({ squadratsAvailable });
			return;
		}
		if (sender.id === globalThis.KrbBrowser.runtime.id && message?.type === "KRB_SHOW_GUIDE") {
			sendResponse({ shown: globalThis.KrbOnboarding?.show() === true });
			return;
		}
		if (sender.id === globalThis.KrbBrowser.runtime.id && message?.type === "KRB_RELOAD_HAZARDS") {
			routePreloadGeneration++;
			window.postMessage({ type: "KRB_RELOAD_HAZARDS" }, location.origin);
			return;
		}
		if (
			sender.id === globalThis.KrbBrowser.runtime.id &&
			message?.type === "KRB_PREVIEW_SQUADRATS" &&
			Number.isFinite(message.opacity) &&
			message.opacity >= 0 &&
			message.opacity <= 100
		) {
			return refresh(false, undefined, message.opacity);
		}
		if (sender.id !== globalThis.KrbBrowser.runtime.id || message?.type !== "KRB_PREVIEW_COLOURS")
			return;
		const colours = message.colours;
		if (
			!colours ||
			!contentSettings.LEVELS.every((level) => /^#[0-9a-f]{6}$/i.test(colours[level]))
		)
			return;
		return refresh(false, colours);
	});

	globalThis.KrbBrowser.storage.onChanged.addListener(function (changes, area) {
		if (area === "local" && changes.localOsmSnapshotUpdatedAt) {
			routePreloadGeneration++;
			window.postMessage({ type: "KRB_RELOAD_HAZARDS" }, location.origin);
			window.postMessage({ type: "KRB_OSM_DATA_UPDATED" }, location.origin);
		}
		if (
			area === "sync" &&
			(changes.trailRules ||
				changes.trailOptions ||
				changes.trailColours ||
				changes.trailVisualsEnabled ||
				changes.squadratsOpacity)
		)
			refresh(false);
	});

	document.addEventListener("click", rememberLayerClick, true);
	document.addEventListener("click", rememberHeatmapSport, true);
	installMapBridge();
	refresh(true);
})();
