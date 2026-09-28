import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../content.js", import.meta.url), "utf8");
const renderer = source.slice(source.indexOf("let latestHazardStatus;"), source.indexOf("function createPanel("));

test("OSM status survives early delivery, shows a notched loading arc and restores concise counts", function () {
	function element() {
		return { dataset: {}, children: [], textContent: "", setAttribute() {}, append(child) { this.children.push(child); } };
	}
	let panel;
	const icon = element();
	const count = element();
	const indicator = element();
	indicator.querySelector = (selector) => selector.endsWith("osm-icon") ? icon : count;
	const context = {
		document: {
			querySelector(selector) { return selector === "#krb-panel" ? panel : undefined; },
			createElement: element
		}
	};
	runInNewContext(renderer, context);
	context.renderHazardStatus({ state: "loading", text: "Loading OSM hazards…" });
	let footer;
	panel = {
		querySelector(selector) { return selector === ".krb-panel__osm" ? indicator : footer; },
		append(node) { footer = node; }
	};
	runInNewContext("renderHazardStatus(latestHazardStatus)", context);
	assert.equal(indicator.dataset.state, "loading");
	assert.match(icon.innerHTML, /<svg.*<path/);
	assert.match(icon.innerHTML, /M 20 12 A 8 8 0 1 1 12 4/);
	assert.equal(footer.textContent, "Loading OSM…");
	context.renderHazardStatus({ state: "finished", text: "Detailed cached-area results", counts: { total: 12, mud: 2, vegetation: 3, narrow: 8, other: 1 } });
	assert.equal(icon.textContent, "✓");
	assert.equal(count.textContent, "12");
	assert.equal(footer.textContent, "12 hazards · Mud 2 · Vegetation 3 · Narrow 8 · Obstacles 1");
	assert.equal(indicator.dataset.tooltip, "Detailed cached-area results");
	context.renderHazardStatus({ state: "idle", text: "" });
	assert.equal(indicator.hidden, true);
	assert.equal(footer.hidden, true);
});


test("floater readiness disables interaction until map styling reports ready", function () {
	const panel = { attributes: {}, classList: { toggle(name, value) { panel.loading = value; } }, setAttribute(name, value) { this.attributes[name] = value; } };
	const start = source.indexOf("let mapReady = false;");
	const code = source.slice(start, source.indexOf("let layersRestoredThisLoad", start));
	const context = { document: { querySelector() { return panel; } } };
	runInNewContext(code, context);
	context.updatePanelReadiness();
	assert.equal(panel.inert, true);
	assert.equal(panel.loading, true);
	runInNewContext("mapReady = true; updatePanelReadiness();", context);
	assert.equal(panel.inert, false);
	assert.equal(panel.attributes["aria-busy"], "false");
	runInNewContext("mapReady = false; updatePanelReadiness();", context);
	assert.equal(panel.inert, true);
});
