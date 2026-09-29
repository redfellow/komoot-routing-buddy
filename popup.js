const popupSettings = globalThis.KrbSettings;

const rulesElement = document.querySelector("#rules");
const status = document.querySelector("#status");
let colourSaveTimer;
let lastSavedColours;
let colourWrites = Promise.resolve();

function render(rules, colours) {
  rulesElement.replaceChildren(...popupSettings.LEVELS.map(function (level) {
    const row = document.createElement("div");
    row.className = "rule";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.style.background = colours[level];
    badge.textContent = level;
    const select = document.createElement("select");
    select.name = level;
	select.setAttribute("aria-label", `${level} display rule`);
    select.innerHTML = `
      <option value="highlight">Colour / highlight</option>
      <option value="avoid">Dark red — avoid</option>
      <option value="off">Do not highlight</option>`;
    select.value = rules[level];
    select.addEventListener("change", save);
		const picker = document.createElement("button");
		picker.type = "button";
		picker.name = level;
		picker.value = colours[level];
		picker.className = "rule__colour";
		picker.style.background = picker.value;
		picker.setAttribute("aria-label", `${level} highlight colour`);
		picker.setAttribute("aria-expanded", "false");
		const editor = document.createElement("div");
		editor.className = "rule__editor";
		editor.hidden = true;
		const sliders = [];
		const hex = document.createElement("input");
		hex.type = "text";
		hex.value = picker.value;
		hex.maxLength = 7;
		hex.setAttribute("aria-label", `${level} hex colour`);
		function update(value) {
			picker.value = value;
			picker.style.background = value;
			badge.style.background = value;
			hex.value = value;
			previewColours();
			window.clearTimeout(colourSaveTimer);
			colourSaveTimer = window.setTimeout(saveColours, 500);
		}
		for (const [index, channel] of ["Red", "Green", "Blue"].entries()) {
			const label = document.createElement("label");
			label.textContent = channel;
			const slider = document.createElement("input");
			slider.type = "range";
			slider.min = "0";
			slider.max = "255";
			slider.step = "1";
			slider.value = parseInt(picker.value.slice(1 + index * 2, 3 + index * 2), 16);
			slider.setAttribute("aria-label", `${level} ${channel.toLowerCase()}`);
			sliders.push(slider);
			slider.addEventListener("input", function () {
				update("#" + sliders.map((input) => Number(input.value).toString(16).padStart(2, "0")).join(""));
			});
			slider.addEventListener("change", saveColours);
			label.append(slider);
			editor.append(label);
		}
		hex.addEventListener("input", function () {
			if (!/^#[0-9a-f]{6}$/i.test(hex.value)) return;
			update(hex.value);
			sliders.forEach(function (slider, index) {
				slider.value = parseInt(hex.value.slice(1 + index * 2, 3 + index * 2), 16);
			});
		});
		hex.addEventListener("change", saveColours);
		const done = document.createElement("button");
		done.type = "button";
		done.textContent = "Done";
		done.addEventListener("click", function () {
			saveColours();
			editor.hidden = true;
			picker.setAttribute("aria-expanded", "false");
		});
		picker.addEventListener("click", function () {
			editor.hidden = !editor.hidden;
			picker.setAttribute("aria-expanded", String(!editor.hidden));
		});
		editor.append(hex, done);
		row.append(badge, select, picker, editor);
    return row;
  }));
}

let previewFrame;
function previewColours() {
	if (previewFrame) return;
	previewFrame = window.requestAnimationFrame(async function () {
		previewFrame = undefined;
		const colours = Object.fromEntries([...rulesElement.querySelectorAll(".rule__colour")]
			.map((picker) => [picker.name, picker.value]));
		try {
			const [tab] = await globalThis.KrbBrowser.tabs.query({ active: true, currentWindow: true });
			if (tab?.id) await globalThis.KrbBrowser.tabs.sendMessage(tab.id, { type: "KRB_PREVIEW_COLOURS", colours });
		}
		catch (error) {
			// The popup may also be opened on a page without our content script.
			console.debug("Routing Buddy colour preview unavailable:", error.message);
		}
	});
}

async function saveColours() {
	window.clearTimeout(colourSaveTimer);
	colourSaveTimer = undefined;
	const trailColours = Object.fromEntries([...rulesElement.querySelectorAll(".rule__colour")]
		.map((picker) => [picker.name, picker.value]));
	const snapshot = JSON.stringify(trailColours);
	if (snapshot === lastSavedColours) return;
	lastSavedColours = snapshot;
	colourWrites = colourWrites.then(async function () {
		await globalThis.KrbBrowser.storage.sync.set({ trailColours });
		status.textContent = "Colours saved — the planner updates automatically.";
	}).catch(function (error) {
		lastSavedColours = undefined;
		status.textContent = "Could not save colours. Please try again.";
		console.error("Routing Buddy could not save colours:", error);
	});
	await colourWrites;
}

async function save() {
  const trailRules = Object.fromEntries([...rulesElement.querySelectorAll("select")]
    .map((select) => [select.name, select.value]));
  await globalThis.KrbBrowser.storage.sync.set({ trailRules });
  status.textContent = "Saved — the planner updates automatically.";
  window.setTimeout(() => { status.textContent = ""; }, 2200);
}

async function saveOptions() {
  const existing = await popupSettings.getOptions();
  await globalThis.KrbBrowser.storage.sync.set({
    trailOptions: {
      ...existing,
      narrowWarningWidth: Number(document.querySelector("#narrowWarningWidth").value),
      maximumTrailLevel: document.querySelector("#maximumLevel").value,
      squadratsBelowRoads: document.querySelector("#squadratsBelowRoads").checked,
      colourLabels: document.querySelector("#colourLabels").checked,
      showHazards: document.querySelector("#showHazards").checked,
		preloadRouteHazards: document.querySelector("#preloadRouteHazards").checked,
      rememberLayers: document.querySelector("#rememberLayers").checked
    }
  });
  status.textContent = "Settings saved.";
  window.setTimeout(() => { status.textContent = ""; }, 2200);
}

document.querySelector("#restore").addEventListener("click", async function () {
  window.clearTimeout(colourSaveTimer);
  colourSaveTimer = undefined;
  await colourWrites;
  lastSavedColours = undefined;
  await globalThis.KrbBrowser.storage.sync.set({ trailRules: popupSettings.DEFAULT_RULES, trailColours: popupSettings.HIGHLIGHT_COLOURS, trailOptions: popupSettings.DEFAULT_OPTIONS, squadratsOpacity: popupSettings.DEFAULT_OPTIONS.squadratsOpacity });
  render(popupSettings.DEFAULT_RULES, popupSettings.HIGHLIGHT_COLOURS);
	document.querySelector("#narrowWarningWidth").value = 0.4;
	document.querySelector("#narrowWarningWidthValue").textContent = "0.4m";
	document.querySelector("#squadratsOpacity").value = popupSettings.DEFAULT_OPTIONS.squadratsOpacity;
	document.querySelector("#squadratsOpacityValue").textContent = `${popupSettings.DEFAULT_OPTIONS.squadratsOpacity}%`;
  document.querySelector("#maximumLevel").value = popupSettings.DEFAULT_OPTIONS.maximumTrailLevel;
  document.querySelector("#squadratsBelowRoads").checked = popupSettings.DEFAULT_OPTIONS.squadratsBelowRoads;
  document.querySelector("#colourLabels").checked = popupSettings.DEFAULT_OPTIONS.colourLabels;
  document.querySelector("#showHazards").checked = popupSettings.DEFAULT_OPTIONS.showHazards;
	document.querySelector("#preloadRouteHazards").checked = false;
  document.querySelector("#rememberLayers").checked = popupSettings.DEFAULT_OPTIONS.rememberLayers;
  status.textContent = "Suggested rules restored.";
});

let squadratsFrame;
let squadratsSaveTimer;
let squadratsWrites = Promise.resolve();
function previewSquadrats() {
	const slider = document.querySelector("#squadratsOpacity");
	document.querySelector("#squadratsOpacityValue").textContent = `${slider.value}%`;
	if (!squadratsFrame) squadratsFrame = window.requestAnimationFrame(async function () {
		squadratsFrame = undefined;
		try {
			const [tab] = await globalThis.KrbBrowser.tabs.query({ active: true, currentWindow: true });
			if (tab?.id) await globalThis.KrbBrowser.tabs.sendMessage(tab.id, { type: "KRB_PREVIEW_SQUADRATS", opacity: Number(slider.value) });
		}
		catch (error) { console.debug("Squadrats preview unavailable:", error.message); }
	});
	window.clearTimeout(squadratsSaveTimer);
	squadratsSaveTimer = window.setTimeout(saveSquadrats, 500);
}

async function saveSquadrats() {
	window.clearTimeout(squadratsSaveTimer);
	squadratsSaveTimer = undefined;
	const opacity = Number(document.querySelector("#squadratsOpacity").value);
	squadratsWrites = squadratsWrites.then(function () {
		return globalThis.KrbBrowser.storage.sync.set({ squadratsOpacity: opacity });
	}).catch(function (error) {
		status.textContent = "Could not save Squadrats opacity. Please try again.";
		console.error("Squadrats opacity save failed:", error);
	});
	await squadratsWrites;
}

async function initialise() {
	if (window.parent !== window) {
		const main = document.querySelector("main");
		const reportSize = () => window.parent.postMessage({ type: "KRB_SETTINGS_SIZE", height: main.getBoundingClientRect().height }, "https://www.komoot.com");
		new ResizeObserver(reportSize).observe(main);
		reportSize();
	}
	document.querySelector("#clearOsmCache").addEventListener("click", async function (event) {
		const button = event.currentTarget;
		button.disabled = true;
		status.textContent = "Clearing OSM cache…";
		try {
			const result = await globalThis.KrbBrowser.runtime.sendMessage({ type: "KRB_CLEAR_OSM_CACHE" });
			if (!result?.ok) throw new Error(result?.error || "Cache clear failed");
			status.textContent = "OSM cache cleared.";
			const [tab] = await globalThis.KrbBrowser.tabs.query({ active: true, currentWindow: true });
			if (tab?.id) {
				try { await globalThis.KrbBrowser.tabs.sendMessage(tab.id, { type: "KRB_RELOAD_HAZARDS" }); }
				catch (error) { console.debug("OSM refresh unavailable:", error.message); }
			}
		}
		catch (error) { status.textContent = `Could not clear OSM cache: ${error.message}`; }
		finally { button.disabled = false; }
	});
	for (const help of document.querySelectorAll(".help")) {
		help.addEventListener("pointerenter", function (event) {
			if (event.pointerType === "mouse") help.open = true;
		});
		help.addEventListener("pointerleave", function (event) {
			if (event.pointerType === "mouse" && !help.contains(document.activeElement)) help.open = false;
		});
	}

  const [rules, options, colours] = await Promise.all([popupSettings.getRules(), popupSettings.getOptions(), popupSettings.getColours()]);
  render(rules, colours);
	const slider = document.querySelector("#squadratsOpacity");
	slider.value = options.squadratsOpacity;
	document.querySelector("#squadratsOpacityValue").textContent = `${options.squadratsOpacity}%`;
	slider.addEventListener("input", previewSquadrats);
	slider.addEventListener("change", saveSquadrats);
  document.querySelector("#maximumLevel").value = options.maximumTrailLevel;
  document.querySelector("#squadratsBelowRoads").checked = options.squadratsBelowRoads !== false;
	document.querySelector("#squadratsBelowRoads").addEventListener("change", saveOptions);
  document.querySelector("#colourLabels").checked = options.colourLabels === true;
	document.querySelector("#colourLabels").addEventListener("change", saveOptions);
  document.querySelector("#showHazards").checked = options.showHazards;
	const narrowSlider = document.querySelector("#narrowWarningWidth");
	narrowSlider.value = options.narrowWarningWidth;
	document.querySelector("#narrowWarningWidthValue").textContent = `${options.narrowWarningWidth.toFixed(1)}m`;
	narrowSlider.addEventListener("input", function () {
		document.querySelector("#narrowWarningWidthValue").textContent = `${Number(narrowSlider.value).toFixed(1)}m`;
	});
	narrowSlider.addEventListener("change", saveOptions);
	document.querySelector("#preloadRouteHazards").checked = options.preloadRouteHazards === true;
	document.querySelector("#preloadRouteHazards").addEventListener("change", saveOptions);
  document.querySelector("#showHazards").addEventListener("change", saveOptions);
  document.querySelector("#rememberLayers").checked = options.rememberLayers;
  document.querySelector("#maximumLevel").addEventListener("change", saveOptions);
  document.querySelector("#rememberLayers").addEventListener("change", saveOptions);
}

window.addEventListener("pagehide", function () {
	if (colourSaveTimer !== undefined) saveColours();
	if (squadratsSaveTimer !== undefined) saveSquadrats();
});

window.addEventListener("keydown", function (event) {
	if (event.key === "Escape" && window.parent !== window) {
		window.parent.postMessage({ type: "KRB_CLOSE_SETTINGS" }, "https://www.komoot.com");
	}
});

initialise();
