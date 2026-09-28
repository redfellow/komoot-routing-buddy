(() => {
const LEVELS = ["S0", "S1", "S2", "S3", "S4", "S5"];

const DEFAULT_RULES = {
  S0: "highlight",
  S1: "highlight",
  S2: "highlight",
  S3: "avoid",
  S4: "avoid",
  S5: "avoid"
};

const DEFAULT_OPTIONS = {
	visualsEnabled: true,
	showHazards: true,
	preloadRouteHazards: false,
	squadratsOpacity: 100,
  maximumTrailLevel: "S5",
  rememberLayers: true,
  rememberedLayers: {}
};

const HIGHLIGHT_COLOURS = {
  S0: "#26a269",
  S1: "#1c9cc5",
  S2: "#6c63ff",
  S3: "#f6a609",
  S4: "#e66b2e",
  S5: "#c01c28"
};

async function getColours() {
	const saved = await globalThis.KrbBrowser.storage.sync.get("trailColours");
	return Object.fromEntries(LEVELS.map(function (level) {
		const colour = saved.trailColours?.[level];
		return [level, /^#[0-9a-f]{6}$/i.test(colour) ? colour : HIGHLIGHT_COLOURS[level]];
	}));
}

async function getRules() {
  const saved = await globalThis.KrbBrowser.storage.sync.get("trailRules");
  return { ...DEFAULT_RULES, ...(saved.trailRules || {}) };
}

async function getOptions() {
  const saved = await globalThis.KrbBrowser.storage.sync.get(["trailOptions", "trailVisualsEnabled", "squadratsOpacity"]);
  const options = { ...DEFAULT_OPTIONS, ...(saved.trailOptions || {}) };
	if (typeof saved.trailVisualsEnabled === "boolean") options.visualsEnabled = saved.trailVisualsEnabled;
	options.squadratsOpacity = Number.isFinite(saved.squadratsOpacity) ? Math.max(0, Math.min(100, saved.squadratsOpacity)) : 100;
  // Version 0.1 stored a { label, selector } object. Keep existing users' choices valid.
  options.rememberedLayers = Object.fromEntries(Object.entries(options.rememberedLayers || {})
    .map(([kind, value]) => [kind, typeof value === "string" ? value : value?.label])
    .filter(([kind, value]) => {
      const valid = {
        mapType: ["Default", "NLS Map", "Satellite", "OpenStreetMap", "OpenCycleMap", "Ordnance Survey", "SwissTopo", "IGN Map", "USGS Map", "Kartverket", "DTK Map"],
        sportMap: ["None", "Hiking", "Cycling", "MTB"],
        heatmap: ["None", "Global", "Personal"],
        heatmapSport: ["All sports", "All foot sports", "Hiking", "Running", "All riding sports", "Cycling", "Mountain biking", "Road cycling", "Gravel riding"]
      };
      return Boolean(value) && valid[kind]?.includes(value);
    }));
  return options;
}

// A classic-script namespace works in both the popup and MV3 content scripts.
globalThis.KrbSettings = {
  LEVELS, DEFAULT_RULES, DEFAULT_OPTIONS, HIGHLIGHT_COLOURS, getRules, getOptions, getColours
};
})();
