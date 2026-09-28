(() => {
	if (!/^\/(?:tour\/[^/]+\/(?:zoom|edit)|plan(?:\/.*)?)$/.test(location.pathname)) return;
const contentSettings = globalThis.KrbSettings;

const AVOID_COLOUR = "#7a1016";
const STYLE_ID = "krb-trail-style";
let restoreTimer;
let layersRestoredThisLoad = false;
let restoringLayers = false;

function installMapBridge() {
  if (document.querySelector("#krb-map-bridge")) return;
  const script = document.createElement("script");
  script.id = "krb-map-bridge";
	script.dataset.hazardIcons = globalThis.KrbBrowser.runtime.getURL("hazard-icons.png");
  script.src = globalThis.KrbBrowser.runtime.getURL("map-bridge.js");
  script.addEventListener("load", () => refresh(false));
  (document.head || document.documentElement).append(script);
}

function sendMapConfig(rules, options, colours) {
  window.postMessage({ type: "KRB_MAP_CONFIG", config: { rules, colours, showHazards: options.showHazards, squadratsOpacity: options.squadratsOpacity, visualsEnabled: options.visualsEnabled !== false, maximumTrailLevel: options.maximumTrailLevel } }, location.origin);
}

window.addEventListener("message", async function (event) {
	if (event.source !== window || event.origin !== location.origin) return;
	if (event.data?.type === "KRB_HAZARD_VIEW") {
		const { bounds, requestId } = event.data;
		const options = await contentSettings.getOptions();
		if (options.visualsEnabled === false || !options.showHazards) return;
		try {
			const result = await globalThis.KrbBrowser.runtime.sendMessage({ type: "KRB_LOAD_HAZARDS", bounds });
			window.postMessage({ type: "KRB_HAZARD_DATA", requestId, ...result }, location.origin);
		}
		catch (error) { window.postMessage({ type: "KRB_HAZARD_DATA", requestId, error: error.message }, location.origin); }
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
	latestHazardStatus = data;
		const panel = document.querySelector("#krb-panel");
		if (!panel) return;
		const indicator = panel.querySelector(".krb-panel__osm");
		const icons = { loading: "", finished: "✓", throttled: "⌛", error: "!", idle: "—" };
		const state = Object.hasOwn(icons, data.state) ? data.state : "idle";
		indicator.dataset.state = state;
		indicator.hidden = data.text === "";
		const icon = indicator.querySelector(".krb-panel__osm-icon");
		if (state === "loading") icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M 20 12 A 8 8 0 1 1 12 4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
		else icon.textContent = icons[state];
		const total = data.counts?.total;
		indicator.querySelector(".krb-panel__osm-count").textContent = Number.isInteger(total) && total >= 0 ? String(total) : "";
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
		status.textContent = ({ loading: "Loading OSM…", throttled: "OSM busy · retry pending", error: "OSM unavailable · move map to retry" })[state] || String(data.text || "").slice(0, 500);
		if (state === "finished" && data.counts) {
			const counts = data.counts;
			const count = (key) => Number.isInteger(counts[key]) && counts[key] >= 0 ? counts[key] : 0;
			status.textContent = `${count("total")} hazards · Mud ${count("mud")} · Vegetation ${count("vegetation")} · Narrow ${count("narrow")} · Obstacles ${count("other")}`;
			const help = document.createElement("details");
			help.className = "krb-panel__hazard-help";
			const summary = document.createElement("summary");
			summary.textContent = "?";
			summary.setAttribute("aria-label", "About hazard counts");
			const explanation = "Counts cover the cached area. Narrow means under 1 metre. Obstacles includes warnings. Categories can overlap; the header counts each feature once. Missing OSM data means unknown conditions.";
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
  panel.open = state?.open !== false;
  panel.innerHTML = `<summary><span class="krb-panel__drag" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span><span class="krb-title"></span><span class="krb-panel__osm" role="status" aria-label="OSM waiting" tabindex="0" data-tooltip="OSM waiting" aria-describedby="krb-osm-tooltip"><span class="krb-panel__osm-icon">—</span><span class="krb-panel__osm-count"></span></span><button type="button" class="krb-panel__toggle" role="switch" aria-checked="true" aria-label="Trail visual changes" title="Toggle trail visual changes">On</button><button type="button" class="krb-panel__settings" aria-label="Open Routing Buddy settings" title="Open settings">⚙</button><span class="krb-caret">⌃</span></summary><div class="krb-legend"></div>`;
  document.documentElement.append(panel);
	setupPanelControls(panel, state || {});
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
	function hide() { tooltip.hidden = true; }
	indicator.addEventListener("pointerenter", show);
	indicator.addEventListener("pointerleave", hide);
	indicator.addEventListener("focus", show);
	indicator.addEventListener("blur", hide);
	indicator.addEventListener("keydown", function (event) {
		if (event.key === "Escape") { hide(); event.stopPropagation(); }
	});
	window.addEventListener("resize", hide);
	panel.querySelector("summary").addEventListener("pointerdown", hide);
}

function toggleSettingsDialog(panel, settings) {
	let dialog = document.querySelector("#krb-settings-dialog");
	if (dialog) {
		dialog.hidden = !dialog.hidden;
		settings.setAttribute("aria-expanded", String(!dialog.hidden));
		if (!dialog.hidden) dialog.querySelector("button").focus();
		return;
	}
	dialog = document.createElement("section");
	dialog.id = "krb-settings-dialog";
	dialog.setAttribute("role", "dialog");
	dialog.setAttribute("aria-label", "Routing Buddy settings");
	const close = document.createElement("button");
	close.className = "krb-settings__close";
	close.type = "button";
	close.textContent = "×";
	close.setAttribute("aria-label", "Close settings");
	const frame = document.createElement("iframe");
	frame.className = "krb-settings__frame";
	frame.title = "Routing Buddy settings";
	frame.src = globalThis.KrbBrowser.runtime.getURL("popup.html");
	dialog.append(close, frame);
	document.documentElement.append(dialog);
	settings.setAttribute("aria-expanded", "true");
	function dismiss() {
		// Keep the settings document alive so pending saves finish after closing.
		dialog.hidden = true;
		settings.setAttribute("aria-expanded", "false");
		settings.focus();
	}
	close.addEventListener("click", dismiss);
	dialog.addEventListener("keydown", function (event) {
		if (event.key === "Escape") { event.stopPropagation(); dismiss(); }
	});
	window.addEventListener("message", function (event) {
		if (event.source !== frame.contentWindow || event.data?.type !== "KRB_CLOSE_SETTINGS") return;
		if (event.origin !== new URL(frame.src).origin) return;
		dismiss();
	});
	function positionDialog() {
		const rect = panel.getBoundingClientRect();
		const width = Math.min(360, window.innerWidth - 16);
		const height = Math.min(510, window.innerHeight - 16);
		dialog.style.width = `${width}px`;
		dialog.style.height = `${height}px`;
		dialog.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
		const top = rect.bottom + 6 + height <= window.innerHeight - 8 ? rect.bottom + 6 : rect.top - height - 6;
		dialog.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;
	}
	positionDialog();
	// Follow dragging, expanding/collapsing, and viewport changes.
	new MutationObserver(positionDialog).observe(panel, { attributes: true, attributeFilter: ["style", "open"] });
	window.addEventListener("resize", positionDialog);
	close.focus();
}

function setupPanelControls(panel, state = {}) {
	const header = panel.querySelector("summary");
	const settings = panel.querySelector(".krb-panel__settings");
	const toggle = panel.querySelector(".krb-panel__toggle");
	toggle.addEventListener("click", async function (event) {
		event.preventDefault();
		event.stopPropagation();
		toggle.disabled = true;
		try {
			const options = await contentSettings.getOptions();
			await globalThis.KrbBrowser.storage.sync.set({ trailVisualsEnabled: options.visualsEnabled === false });
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
		pendingSave = pendingSave.then(function () {
			return globalThis.KrbBrowser.storage.local.set({ panelState });
		}).catch(function (error) {
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
		drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
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
	settings.addEventListener("click", function (event) {
		event.preventDefault();
		event.stopPropagation();
		toggleSettingsDialog(panel, settings);
	});
}

function difficultySelector(level) {
  const lower = level.toLowerCase();
  return [
    `[data-mtb-difficulty="${level}"]`, `[data-mtb-difficulty="${lower}"]`,
    `[data-trail-difficulty="${level}"]`, `[data-trail-difficulty="${lower}"]`,
    `[data-sac-scale="${level}"]`,
    `[class~="mtb-${lower}"]`, `[class~="difficulty-${lower}"]`, `[class~="${lower}"]`
  ].join(", ");
}

function applyTrailStyles(rules, maximumTrailLevel) {
  let css = "";
  for (const level of contentSettings.LEVELS) {
    const selector = difficultySelector(level);
    const rule = contentSettings.LEVELS.indexOf(level) > contentSettings.LEVELS.indexOf(maximumTrailLevel) ? "off" : rules[level];
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
  const legend = document.querySelector("#krb-panel .krb-legend");
  if (!legend) return;
  legend.replaceChildren(...contentSettings.LEVELS.map((level) => {
    const mode = contentSettings.LEVELS.indexOf(level) > contentSettings.LEVELS.indexOf(maximumTrailLevel) ? "off" : rules[level];
    const item = document.createElement("div");
    item.className = `krb-level ${mode === "off" ? "krb-muted" : ""} ${mode === "avoid" ? "krb-avoid" : ""}`;
    const dot = document.createElement("span");
    dot.className = "krb-dot";
    dot.style.background = mode === "avoid" ? AVOID_COLOUR : colours[level];
    item.append(dot, document.createTextNode(level));
    return item;
  }));
}

function layerKind(element) {
  const imageSource = element.querySelector('img[alt="map layer"]')?.getAttribute("src") || "";
  if (imageSource.includes("baselayer-")) return "mapType";
  if (imageSource.includes("overlay-komoot-sport-specific-")) return "sportMap";
  if (imageSource.includes("heatmap-")) return "heatmap";
  return null;
}

function layerLabel(element) {
  return element.getAttribute("aria-label") || element.textContent?.trim() || "";
}

const HEATMAP_SPORTS = ["All sports", "All foot sports", "Hiking", "Running", "All riding sports", "Cycling", "Mountain biking", "Road cycling", "Gravel riding"];

async function rememberHeatmapSport(event) {
  if (restoringLayers || !document.body.innerText.includes("Heatmap settings")) return;
  let node = event.target;
  while (node && node !== document.body) {
    const label = node.textContent?.trim();
    if (HEATMAP_SPORTS.includes(label)) {
      const options = await contentSettings.getOptions();
      if (options.rememberLayers) await globalThis.KrbBrowser.storage.sync.set({
        trailOptions: { ...options, rememberedLayers: { ...options.rememberedLayers, heatmapSport: label } }
      });
      return;
    }
    node = node.parentElement;
  }
}

async function rememberLayerClick(event) {
  if (restoringLayers) return;
  const element = event.target.closest("button, [role=menuitem], [role=option], label");
  if (!element || element.closest("#krb-panel")) return;
  const kind = layerKind(element);
  const label = layerLabel(element);
  if (!kind || !label || label === "Layers") return;
  const options = await contentSettings.getOptions();
  if (!options.rememberLayers) return;
  await globalThis.KrbBrowser.storage.sync.set({
    trailOptions: { ...options, rememberedLayers: { ...options.rememberedLayers, [kind]: label } }
  });
}

function findLayerMenuOpener() {
  const dataControlButton = document.querySelector("[data-control-layers-button] button");
  if (dataControlButton) return dataControlButton;
  return [...document.querySelectorAll("button")].find((element) =>
    element.querySelector('img[alt="map layer"]') && /layers/i.test(element.textContent || "")
  );
}

function findLayerOption(kind, label) {
  return [...document.querySelectorAll('button[aria-label]')].find((element) =>
    layerKind(element) === kind && layerLabel(element) === label
  );
}

function findHeatmapSport(label) {
  return [...document.querySelectorAll("p")].find((element) => element.textContent?.trim() === label);
}

function heatmapSportIsSelected(label) {
  let row = findHeatmapSport(label);
  // The radio is a sibling of the label block, four wrappers above the <p> in Komoot's sheet.
  for (let depth = 0; row && depth < 5; depth += 1, row = row.parentElement) {
    if (row.querySelector(':scope input[type="radio"]:checked')) return true;
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
				if (sheet.querySelector('button[aria-label="Close"]') &&
					sheet.querySelector('img[alt="map layer"], input[type="radio"]')) {
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
		const heading = [...document.querySelectorAll("p")].find((element) =>
			["Customize map", "Heatmap settings"].includes(element.textContent?.trim()));
		const closeButton = heading?.parentElement?.querySelector('button[aria-label="Close"][aria-disabled="false"]');
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
  const finishRestore = () => {
		if (finishing) return;
		finishing = true;
		window.clearInterval(restoreTimer);
		closeLayerSheetWhenAvailable(function () {
			window.clearTimeout(restorationDeadline);
			revealSheets();
			restoringLayers = false;
		});
  };
  restoreTimer = window.setInterval(() => {
    attempts += 1;
		if (attempts > 30) { finishRestore(); return; }
    const opener = findLayerMenuOpener();
    if (!opener) {
      if (attempts >= 30) finishRestore();
      return;
    }

    const ensureLayerSheet = (kind) => {
      const option = findLayerOption(kind, layers[kind]);
      if (!option && !layerSheetOpened) { opener.click(); layerSheetOpened = true; }
      return option;
    };
    if (step === "heatmap") {
      if (!layers.heatmap) { step = "sportMap"; return; }
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
      if (!layers.sportMap) { step = "mapType"; return; }
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
    } else if (attempts >= 30) {
      finishRestore();
    }
  }, 350);
}

async function refresh(shouldRestore = false, previewColours, squadratsOpacity) {
  const [rules, options, savedColours] = await Promise.all([contentSettings.getRules(), contentSettings.getOptions(), contentSettings.getColours()]);
	if (Number.isFinite(squadratsOpacity)) options.squadratsOpacity = squadratsOpacity;
  const colours = previewColours || savedColours;
  const { panelState } = await globalThis.KrbBrowser.storage.local.get("panelState");
  createPanel(panelState);
  renderLegend(rules, options.maximumTrailLevel, colours);
	const panel = document.querySelector("#krb-panel");
	const enabled = options.visualsEnabled !== false;
	const toggle = panel.querySelector(".krb-panel__toggle");
	toggle.setAttribute("aria-checked", String(enabled));
	toggle.textContent = enabled ? "On" : "Off";
	panel.classList.toggle("krb-panel--disabled", !enabled);
	if (!enabled) document.getElementById(STYLE_ID)?.remove();
	if (!options.showHazards) renderHazardStatus({ state: "idle", text: "" });
	else if (!latestHazardStatus?.text) renderHazardStatus({ state: "loading", text: "Connecting to OSM map…" });
  sendMapConfig(rules, options, colours);
  if (shouldRestore) restoreLayers(options);
}

globalThis.KrbBrowser.runtime.onMessage.addListener(function (message, sender) {
	if (sender.id === globalThis.KrbBrowser.runtime.id && message?.type === "KRB_PREVIEW_SQUADRATS" &&
		Number.isFinite(message.opacity) && message.opacity >= 0 && message.opacity <= 100) {
		return refresh(false, undefined, message.opacity);
	}
	if (sender.id !== globalThis.KrbBrowser.runtime.id || message?.type !== "KRB_PREVIEW_COLOURS") return;
	const colours = message.colours;
	if (!colours || !contentSettings.LEVELS.every((level) => /^#[0-9a-f]{6}$/i.test(colours[level]))) return;
	return refresh(false, colours);
});

globalThis.KrbBrowser.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && (changes.trailRules || changes.trailOptions || changes.trailColours || changes.trailVisualsEnabled || changes.squadratsOpacity)) refresh(false);
});

document.addEventListener("click", rememberLayerClick, true);
document.addEventListener("click", rememberHeatmapSport, true);
installMapBridge();
refresh(true);
})();
