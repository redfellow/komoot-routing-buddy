// Ride overview and explicit POI approval. Route mutations belong to the verified Komoot adapter.
(function () {
	const overview = globalThis.KrbRideOverview;
	let panel, trigger, dialog, controller, snapshot, result, gradeData, checksReady, requestId = 0, requestTimer, awaitingSnapshot = false, inserting = false;
	const selections = new Map(), previewControls = [], choices = [];
	let previewSequence = 0, activePreview;
	function field(name) {
		return dialog.querySelector(`[data-ride="${name}"]`);
	}
	function post(message) {
		window.postMessage(message, location.origin);
	}
	function status(text) {
		field("status").textContent = text;
	}
	function checkState(value) {
		const labels = { idle: "Not checked", reading: "Reading route…", checking: `Checking ${value.percent || 0}%`, ready: value.count ? `${value.count} warning${value.count === 1 ? "" : "s"}` : value.assessed === 0 ? "No matched MTB trails" : value.gaps ? "Complete · data gaps" : "Complete", incomplete: "Incomplete — retry available", cancelled: "Cancelled — retry available", stale: "Outdated — reanalyse" };
		field("check-state").textContent = labels[value.phase] || "Not checked";
		field("check-state").setAttribute("data-state", value.phase);
	}
	function selectionState() {
		field("add").disabled = inserting || selections.size === 0 || selections.size > 100 || !globalThis.KrbKomootPois?.available?.();
		field("add").textContent = selections.size > 100 ? "Select at most 100 POIs" : selections.size ? `Add ${selections.size} approved POI${selections.size === 1 ? "" : "s"}` : "Select POIs to add";
		field("selection-count").textContent = `${selections.size} selected${selections.size > 100 ? " · limit 100" : ""}`;
	}

	function clearPreview() {
		if (!activePreview) return;
		post({ type: "KRB_ROUTE_FOCUS", routeKey: activePreview.routeKey, previewId: activePreview.id, clearPreview: true });
		activePreview = undefined;
	}
	function attachPreview(target, getMessage) {
		const id = `preview:${++previewSequence}`;
		function show(event) {
			if (event?.pointerType === "touch" || inserting || dialog.hidden || !result || !snapshot) return;
			let message;
			try {
				message = getMessage();
			}
			catch (error) {
				console.debug("Route preview unavailable:", error.message);
				return;
			}
			if (!message) return;
			clearPreview();
			activePreview = { id, routeKey: message.routeKey };
			post({ type: "KRB_ROUTE_FOCUS", ...message, previewOnly: true, previewId: id });
		}
		function hide(event) {
			if (event?.relatedTarget && target.contains?.(event.relatedTarget)) return;
			if (activePreview?.id === id) clearPreview();
		}
		target.addEventListener("pointerenter", show);
		target.addEventListener("pointerleave", hide);
		target.addEventListener("focusin", show);
		target.addEventListener("focusout", hide);
	}
	function invalidate(text, changed) {
		const active = document.activeElement,
			lostFocus = dialog && ["results", "preview", "segments"].some((name) => field(name).contains?.(active));
		clearPreview();
		globalThis.KrbKomootPois?.cancel?.();
		clearTimeout(requestTimer);
		requestId++;
		awaitingSnapshot = false;
		controller?.abort();
		controller = undefined;
		snapshot = result = undefined;
		selections.clear();
		if (!dialog) return;
		field("analyse").disabled = inserting;
		field("options").disabled = inserting;
		previewControls.length = 0;
		choices.length = 0;
		field("generate").disabled = true;
		field("add").disabled = true;
		field("candidates").replaceChildren();
		field("timeline").replaceChildren();
		field("segments").hidden = true;
		field("character").replaceChildren();
		field("summary").textContent = "";
		field("results").hidden = true;
		field("preview").hidden = true;
		field("welcome").hidden = false;
		field("generate").hidden = true;
		field("add").hidden = true;
		field("analyse").textContent = "Analyse route";
		field("ride-state").textContent = changed ? "Outdated — reanalyse" : "Not analysed";
		field("changed").hidden = !changed;
		if (changed) field("changed").textContent = changed;
		if (text) status(text);
		if (lostFocus) field(inserting ? "close" : "analyse").focus();
	}
	function options() {
		const values = {
			trailLength: Number(field("trail-length").value),
			gravelLength: Number(field("gravel-length").value),
			technicalLength: Number(field("technical-length").value),
			trailGap: Number(field("trail-gap").value),
			hillAscent: Number(field("ascent").value),
			steepGradient: Number(field("gradient").value),
			steepLength: Number(field("length").value),
		};
		if (Object.entries(values).some(([key, value]) => !Number.isFinite(value) || (key === "trailGap" ? value < 0 : value <= 0)))
			throw new Error("Enter positive thresholds and a trail gap of zero or more metres.");
		return overview.preferences(values);
	}
	function km(value) {
		return `${(value / 1000).toFixed(1)} km`;
	}
	function length(value) {
		return value < 1000 ? `${Math.round(value)} m` : km(value);
	}
	function percent(value, total) {
		const rounded = Math.round(value / total * 100);
		return value > 0 && rounded === 0 ? "<1" : String(rounded);
	}
	function warningSymbol(warning) {
		const kind = warning.kind === "hazard" && /fallen tree|obstacle|gate|barrier/i.test(warning.text) ? "obstacle" : warning.kind,
			paths = {
				difficulty: `<path d="m3 19 7-14 4 8 3-5 4 11H3Z"/><path d="m8 9 2 2 2-2"/>`,
				width: `<path d="M4 5v14M20 5v14M7 12h10m-7-3-3 3 3 3m4-6 3 3-3 3"/>`,
				obstacle: `<path d="M5 8v12M19 8v12M3 8h18v6H3Z"/><path d="m5 14 6-6m1 6 6-6"/>`,
				hazard: `<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3h.01"/>`,
			},
			icon = document.createElement("span");
		icon.className = "krb-ride__warning-symbol";
		icon.setAttribute("aria-hidden", "true");
		icon.setAttribute("data-warning-symbol", paths[kind] ? kind : "hazard");
		icon.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[kind] || paths.hazard}</svg>`;
		return icon;
	}
	function render() {
		const { totals, totalDistance } = result;
		field("results").hidden = false;
		field("ride-state").textContent = "Ready";
		field("shape").open = true;
		field("welcome").hidden = true;
		field("distance").textContent = km(totalDistance);
		field("ascent-total").textContent = (result.ascentAvailable ?? Boolean(result.elevationCoverage)) ? `${Math.round(result.ascent)} m` : "Unavailable";
		field("ascent-label").textContent = result.ascentSource === "profile" && result.elevationCoverage < 1 - 1e-9 ? "Known ascent" : "Ascent";
		field("trail-total").textContent = length(totals.trail + (totals.technical || 0));
		field("summary").textContent = overview.describe ? overview.describe(result, { includeCoverage: false }) : "Your ride is ready to explore.";
		field("coverage").textContent = result.elevationCoverage < 1 - 1e-9
			? `Elevation missing · ${Math.round((1 - result.elevationCoverage) * 100) || "<1"}%` : "";
		field("coverage-notice").hidden = !field("coverage").textContent;
		field("grades").textContent = result.missingMtbDistance > 1 ? `MTB grades missing · ${length(result.missingMtbDistance)}` : "";
		field("grades-notice").hidden = !field("grades").textContent;
		field("surfaces").textContent = result.surfaceTotals
			? `${percent(result.surfaceTotals.paved, totalDistance)}% paved · ${percent(result.surfaceTotals.unpaved, totalDistance)}% unpaved · ${percent(result.surfaceTotals.unknown, totalDistance)}% unknown` : "";
		for (const [fieldName, totals, kind] of [["surface-details", result.surfaceDetailTotals, "surface"], ["way-types", result.wayTypeTotals, "way"]]) {
			field(fieldName).replaceChildren();
			for (const entry of overview.breakdown?.(totals, kind) || []) {
				const row = document.createElement("li"), name = document.createElement("span"), amount = document.createElement("span");
				name.textContent = entry.label;
				amount.textContent = `${length(entry.distance)} · ${percent(entry.distance, totalDistance)}%`;
				row.append(name, amount);
				field(fieldName).append(row);
			}
		}
		field("timeline").replaceChildren();
		field("character").replaceChildren();
		for (const section of result.characterSections || []) {
			const segment = document.createElement("span");
			segment.className = `krb-ride__segment krb-ride__segment--${section.character}`;
			segment.style.width = `${(section.end - section.start) / totalDistance * 100}%`;
			segment.title = `${section.character}: ${km(section.start)}–${km(section.end)}`;
			segment.setAttribute("aria-label", segment.title);
			field("character").append(segment);
		}
		renderEvents();
		field("segments").open = true;
		field("generate").disabled = false;
		field("generate").hidden = false;
		field("analyse").textContent = "Reanalyse";
		status("Ready to choose your route POIs.");
	}
	function sectionMessage(section) {
		if (!snapshot?.points || !result || inserting) return;
		const start = section.end ? section.distance : Math.max(0, section.distance - 100),
			end = section.end || Math.min(result.totalDistance, section.distance + 100),
			coordinates = overview.sectionCoordinates(snapshot.points, start, end);
		return { routeKey: snapshot.routeKey, point: section.point || coordinates[0], coordinates, fitSection: true,
			paddingRight: (dialog.getBoundingClientRect?.()?.width || 480) + 28 };
	}
	function focusSection(section) {
		try {
			const message = sectionMessage(section);
			if (!message) return;
			clearPreview();
			post({ type: "KRB_ROUTE_FOCUS", ...message });
		}
		catch (error) {
			status(`Could not highlight this section: ${error.message}`);
		}
	}
	function highlightMissingGrades() {
		if (!snapshot?.points || !result?.missingMtbSections?.length || inserting) return;
		try {
			const sections = result.missingMtbSections.map((section) => overview.sectionCoordinates(snapshot.points, section.start, section.end));
			if (sections.reduce((count, coordinates) => count + coordinates.length, 0) > 100000)
				throw new Error("Too many missing-grade stretches to highlight at once.");
			clearPreview();
			const id = `missing-grades:${++previewSequence}`;
			activePreview = { id, routeKey: snapshot.routeKey };
			post({ type: "KRB_ROUTE_FOCUS", routeKey: snapshot.routeKey, previewId: id, previewOnly: true, replaceHighlight: true,
				point: sections[0][0], coordinates: sections[0], sections });
		}
		catch (error) {
			status(`Could not highlight missing grades: ${error.message}`);
		}
	}
	function renderEvents() {
		const analysis = result,
			data = !snapshot || gradeData?.routeKey === snapshot.routeKey ? gradeData : undefined,
			factor = result && data?.distance > 0 ? result.totalDistance / data.distance : 1,
			entries = [...(result?.sections || []).map((section) => ({ ...section, warning: false })),
				...(data?.warnings || []).map((warning) => ({ start: warning.distance * factor, warning: true, detail: warning }))];
		entries.sort((a, b) => a.start - b.start);
		field("timeline").replaceChildren();
		field("segments").hidden = entries.length === 0;
		const count = data?.warnings?.length || 0;
		field("event-count").textContent = count ? `${count} warning${count === 1 ? "" : "s"}` : "";
		for (const entry of entries) {
			const item = document.createElement("li");
			item.className = `krb-ride__event krb-ride__event--${entry.warning ? "warning" : entry.kind}`;
			if (entry.warning) {
				const button = document.createElement("button");
				button.type = "button";
				button.className = "krb-ride__warning";
				const warningType = { difficulty: "Difficulty", width: "Width", hazard: "Mapped hazard" }[entry.detail.kind] || "Warning";
				const copy = document.createElement("span");
				copy.className = "krb-ride__warning-copy";
				copy.textContent = `${km(entry.start)} · ${warningType}: ${entry.detail.text}`;
				button.append(warningSymbol(entry.detail), copy);
				const icon = document.createElement("span");
				icon.className = "krb-ride__section-icon";
				icon.setAttribute("aria-hidden", "true");
				icon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10" cy="10" r="6"/><path d="m14.5 14.5 5 5"/></svg>`;
				button.append(icon);
				button.setAttribute("aria-label", `${warningType} at ${km(entry.start)}: ${entry.detail.text}. Show on map.`);
				button.addEventListener("click", function () {
					if (inserting || gradeData !== data) return;
					clearPreview();
					post({ type: "KRB_ROUTE_FOCUS", routeKey: data.routeKey, point: entry.detail.point, coordinates: entry.detail.coordinates });
				});
				attachPreview(button, function () {
					return gradeData === data ? { routeKey: data.routeKey, point: entry.detail.point, coordinates: entry.detail.coordinates } : undefined;
				});
				item.append(button);
			}
			else {
				const button = document.createElement("button"),
					name = { trails: "Trails", gravel: "Gravel", technical: "Technical", hills: "Hills", steep: "Steep climb" }[entry.kind];
				button.type = "button";
				button.className = "krb-ride__section-button";
				const copy = document.createElement("span"), heading = document.createElement("strong"), detail = document.createElement("span");
				heading.textContent = `${km(entry.start)}–${km(entry.end)}: ${name}`;
				detail.className = "krb-ride__choice-detail";
				detail.textContent = overview.sectionDetail?.(entry) || "";
				copy.append(heading, detail);
				button.append(copy);
				const icon = document.createElement("span");
				icon.className = "krb-ride__section-icon";
				icon.setAttribute("aria-hidden", "true");
				icon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10" cy="10" r="6"/><path d="m14.5 14.5 5 5"/></svg>`;
				button.append(icon);
				button.title = "Zoom to and highlight this section";
				button.setAttribute("aria-label", `Zoom to ${name} section from ${km(entry.start)} to ${km(entry.end)}`);
				button.addEventListener("click", function () {
					if (result === analysis) focusSection({ distance: entry.start, end: entry.end });
				});
				attachPreview(button, () => result === analysis ? sectionMessage({ distance: entry.start, end: entry.end }) : undefined);
				item.append(button);
			}
			field("timeline").append(item);
		}
	}
	async function analyse(message) {
		const run = controller;
		try {
			snapshot = { route: message.route, routeKey: message.routeKey, nativeProfile: message.nativeProfile };
			globalThis.KrbKomootPois?.configure?.(message);
			if (!message.nativeProfile) throw new Error("Komoot route metadata is not ready. Try again when the route has loaded.");
			const features = gradeData?.routeKey === message.routeKey ? gradeData.features : [];
			let points = await overview.fromKomoot(message.nativeProfile, features);
			run.signal.throwIfAborted();
			if (gradeData?.routeKey === message.routeKey && gradeData.features !== features) {
				points = await overview.fromKomoot(message.nativeProfile, gradeData.features);
				run.signal.throwIfAborted();
			}
			snapshot.points = points;
			result = overview.analyse(points, options());
			render();
			field("body").scrollTop = 0;
		}
		catch (error) {
			if (!run.signal.aborted) {
				field("ride-state").textContent = "Unavailable — try again";
				status(`Could not analyse ride: ${error.message}`);
			}
		}
		finally {
			if (controller === run) {
				controller = undefined;
				field("analyse").disabled = false;
			}
		}
	}
	function enrichGrades(data) {
		if (dialog.hidden || (!snapshot && !controller)) return;
		if (snapshot && snapshot.routeKey !== data.routeKey) return;
		gradeData = data;
		renderEvents();
		if (!snapshot?.nativeProfile || snapshot.routeKey !== data.routeKey || controller || inserting) return;
		try {
			const points = overview.fromKomoot(snapshot.nativeProfile, data.features);
			if (Array.isArray(points) && Array.isArray(snapshot.points) && points.length === snapshot.points.length &&
				points.every((point, index) => point.character === snapshot.points[index].character && point.mtbGrade === snapshot.points[index].mtbGrade)) return;
			snapshot.points = points;
			const shapeOpen = field("shape").open, previewWasVisible = !field("preview").hidden;
			result = overview.analyse(points, options());
			selections.clear();
			clearPreview();
			choices.length = 0;
			previewControls.length = 0;
			field("preview").hidden = true;
			field("add").hidden = true;
			field("add").disabled = true;
			field("candidates").replaceChildren();
			render();
			field("shape").open = shapeOpen;
			if (previewWasVisible) field("generate").focus();
			status("MTB grades updated. Preview POIs again to review the changes.");
		}
		catch (error) {
			status(`Could not update MTB grades: ${error.message}`);
		}
	}
	function generate() {
		if (!result || inserting) return;
		clearPreview();
		previewControls.length = 0;
		choices.length = 0;
		selections.clear();
		field("candidates").replaceChildren();
		for (const poi of overview.markExisting(result.pois, snapshot.nativeProfile?.existingPois || [])) {
			const item = document.createElement("li"),
				label = document.createElement("label"),
				checkbox = document.createElement("input"),
				text = document.createElement("span");
			checkbox.type = "checkbox";
			checkbox.checked = !poi.alreadyPresent;
			checkbox.disabled = poi.alreadyPresent;
			checkbox.setAttribute("data-already-present", String(poi.alreadyPresent));
			item.className = "krb-ride__candidate";
			label.className = "krb-ride__choice";
			text.className = "krb-ride__choice-copy";
			const badge = document.createElement("span"), title = document.createElement("strong"), detail = document.createElement("span");
			badge.className = `krb-ride__badge krb-ride__badge--${poi.kind}`;
			badge.textContent = { trails: "↟", gravel: "≋", technical: "⌁", hills: "↗", steep: "↗", halfway: "½" }[poi.kind];
			badge.setAttribute("aria-hidden", "true");
			title.textContent = poi.name;
			detail.className = "krb-ride__choice-detail";
			if (!poi.alreadyPresent) selections.set(poi.id, poi);
			detail.textContent = `${poi.alreadyPresent ? "Already on route · " : ""}At ${km(poi.distance)}` +
				(overview.sectionDetail?.(poi) ? ` · ${overview.sectionDetail(poi)}` : "");
			checkbox.addEventListener("change", function () {
				if (inserting || poi.alreadyPresent || !snapshot || !result || !choices.some((choice) => choice.checkbox === checkbox)) return;
				if (checkbox.checked) selections.set(poi.id, poi);
				else selections.delete(poi.id);
				selectionState();
			});
			const reason = document.createElement("span");
			reason.className = "krb-ride__choice-detail";
			reason.textContent = poi.reason || "";
			text.append(title, detail, reason);
			label.append(checkbox, badge, text);
			const focus = document.createElement("button");
			focus.type = "button";
			focus.className = "krb-ride__focus";
			focus.setAttribute("aria-label", `Zoom to ${poi.name} at ${km(poi.distance)}`);
			focus.title = "Zoom to and highlight on the map";
			focus.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/><path d="M8 10.5h5m-2.5-2.5v5"/></svg>`;
			focus.addEventListener("click", function () {
				if (choices.some((choice) => choice.checkbox === checkbox)) focusSection(poi);
			});
			previewControls.push(checkbox, focus);
			choices.push({ poi, checkbox });
			attachPreview(item, () => choices.some((choice) => choice.checkbox === checkbox) ? sectionMessage(poi) : undefined);
			item.append(label, focus);
			field("candidates").append(item);
		}
		field("preview").hidden = false;
		field("preview").open = true;
		field("shape").open = false;
		field("segments").open = false;
		field("generate").hidden = true;
		field("add").hidden = false;
		selectionState();
		field("preview-title").focus();
		status(globalThis.KrbKomootPois?.available?.() ? "Preview only. Add the points you want, then save in Komoot." : "Suggestions ready. Open a ready Komoot route editor to add these POIs; nothing has been added.");
	}
	async function startChecks(generation) {
		try {
			await checksReady;
			if (generation !== requestId || dialog.hidden || inserting) return;
			globalThis.KrbRouteDialog?.start();
		}
		catch (error) {
			status(`Trail check could not start: ${error.message}`);
		}
	}
	function open() {
		if (!dialog) {
			dialog = document.createElement("section");
			dialog.className = "krb-ride";
			dialog.setAttribute("role", "dialog");
			dialog.setAttribute("aria-modal", "false");
			dialog.setAttribute("aria-labelledby", "krb-ride-title");
			dialog.innerHTML = `
				<header class="krb-ride__header">
					<div><p class="krb-ride__eyebrow">Komoot Routing Buddy</p><h2 id="krb-ride-title">Analyse route</h2></div>
					<button class="krb-ride__close" type="button" data-ride="close" aria-label="Close route analysis">×</button>
				</header>
				<div class="krb-ride__run-status" role="group" aria-label="Analysis progress"><span>Ride data: <strong data-ride="ride-state">Not analysed</strong></span><span>Trail checks: <strong data-ride="check-state">Not checked</strong></span></div>
				<div class="krb-ride__body" data-ride="body">
					<p class="krb-ride__changed" data-ride="changed" role="status" hidden></p>
					<section class="krb-ride__welcome" data-ride="welcome">
						<span class="krb-ride__welcome-symbol" aria-hidden="true">↟</span>
						<h3>Know what’s coming.</h3><p>Find the trail stretches, hills and steep climbs along your route. Then choose which moments to keep as named route POIs.</p>
						<p class="krb-ride__muted">Start with the route you’ve planned in Komoot.</p>
					</section>
					<section data-ride="results" hidden>
						<p class="krb-ride__story" data-ride="summary"></p>
						<div class="krb-ride__stats">
							<div><span>Distance</span><strong data-ride="distance"></strong></div>
							<div><span data-ride="ascent-label">Ascent</span><strong data-ride="ascent-total"></strong></div>
							<div><span>Trails & technical</span><strong data-ride="trail-total"></strong></div>
						</div>
						<details class="krb-ride__shape" data-ride="shape" open><summary>The shape of your ride</summary>
						<div class="krb-ride__timeline" data-ride="character" role="group" aria-label="Route character by distance"></div>
						<div class="krb-ride__scale"><span>Start</span><span>Halfway</span><span>Finish</span></div>
						<div class="krb-ride__legend"><span class="krb-ride__key krb-ride__key--trail">Trails</span><span class="krb-ride__key krb-ride__key--technical">Technical</span><span class="krb-ride__key krb-ride__key--gravel">Gravel</span><span class="krb-ride__key krb-ride__key--paved">Paved</span><span class="krb-ride__key krb-ride__key--unknown">Unknown</span></div>
						<p class="krb-ride__surfaces" data-ride="surfaces"></p>
						<div class="krb-ride__breakdowns"><details><summary>Surfaces</summary><ul class="krb-ride__breakdown" data-ride="surface-details"></ul></details><details><summary>Way types</summary><ul class="krb-ride__breakdown" data-ride="way-types"></ul></details></div>
						<details class="krb-ride__notice" data-ride="grades-notice" hidden><summary data-ride="grades"></summary><p>Grade-based classification is unavailable for these portions. Surface and way-type information is still used.</p><button class="krb-ride__button krb-ride__button--secondary" type="button" data-ride="highlight-grades" title="Highlight all missing-grade stretches for 8 seconds without moving the map">Highlight gaps</button></details>
						<details class="krb-ride__notice" data-ride="coverage-notice" hidden><summary data-ride="coverage"></summary><p>Climb suggestions use continuous sections with known elevation. The overview cannot locate the end of the main climbing while elevation is incomplete.</p></details></details>
					</section>
					<details class="krb-ride__events" data-ride="segments" hidden open><summary>Along the route <span data-ride="event-count"></span></summary><ol class="krb-ride__sections" data-ride="timeline"></ol></details>
					<details class="krb-ride__preview krb-ride__events" data-ride="preview" hidden>
						<summary data-ride="preview-title">Proposed POIs <span data-ride="selection-count"></span></summary>
						<p class="krb-ride__muted">Choose what to add to your Komoot route.</p>
						<ul class="krb-ride__candidates" data-ride="candidates"></ul>
						<p class="krb-ride__source">Named route POIs · save your route in Komoot to keep them</p>
					</details>
					<div data-ride="checks"></div>
					<details class="krb-ride__settings"><summary>Detection settings</summary>
						<p class="krb-ride__muted">Fine-tune which sections are worth marking.</p>
						<fieldset data-ride="options"><legend class="krb-ride__sr-only">Section thresholds</legend>
						<label>Minimum Trails section <span><input data-ride="trail-length" type="number" min="1" value="500" /> m</span></label>
						<label>Minimum Gravel section <span><input data-ride="gravel-length" type="number" min="1" value="2000" /> m</span></label>
						<label>Minimum Technical section <span><input data-ride="technical-length" type="number" min="1" value="500" /> m</span></label>
						<label>Join section gaps up to <span><input data-ride="trail-gap" type="number" min="0" value="150" /> m</span></label>
						<label>Hills: ascent within 5 km <span><input data-ride="ascent" type="number" min="1" value="150" /> m</span></label>
						<label>Steep climb gradient <span><input data-ride="gradient" type="number" min="1" value="8" /> %</span></label>
						<label>Minimum steep climb <span><input data-ride="length" type="number" min="1" value="300" /> m</span></label>
						</fieldset>
					</details>
				</div>
				<footer class="krb-ride__footer">
					<p class="krb-ride__status" data-ride="status" role="status" aria-live="polite">Ready when your route is.</p>
					<div class="krb-ride__actions">
						<button class="krb-ride__button krb-ride__button--secondary" type="button" data-ride="analyse">Analyse route</button>
						<button class="krb-ride__button krb-ride__button--primary" type="button" data-ride="generate" disabled hidden>Preview route POIs</button>
						<button class="krb-ride__button krb-ride__button--primary" type="button" data-ride="add" disabled hidden>Add approved POIs</button>
					</div>
				</footer>`;
			document.documentElement.append(dialog);
			checksReady = globalThis.KrbRouteDialog?.mount(field("checks"), enrichGrades, checkState);
			field("analyse").addEventListener("click", function () {
				if (inserting) return;
				invalidate();
				try {
					options();
				}
				catch (error) {
					status(error.message);
					return;
				}
				controller = new AbortController();
				awaitingSnapshot = true;
				field("analyse").disabled = true;
				field("ride-state").textContent = "Reading route…";
				status("Reading Komoot route…");
				post({ type: "KRB_ROUTE_SNAPSHOT", requestId: `ride:${requestId}`, includeProfile: true });
				requestTimer = setTimeout(() => invalidate("Komoot route did not respond. Try again."), 10000);
				const generation = requestId;
				void startChecks(generation);
			});
			field("options").addEventListener("change", () => invalidate("Thresholds changed. Analyse again to refresh suggestions.", "Settings changed — reanalyse"));
			field("generate").addEventListener("click", generate);
			field("highlight-grades").addEventListener("click", highlightMissingGrades);
			field("add").addEventListener("click", async function () {
				if (!snapshot || !selections.size || selections.size > 100 || inserting || !globalThis.KrbKomootPois?.available?.()) return;
				globalThis.KrbRouteDialog?.cancel();
				globalThis.KrbRouteDialog?.setPaused?.(true);
				inserting = true;
				clearPreview();
				field("analyse").disabled = true;
				field("options").disabled = true;
				field("highlight-grades").disabled = true;
				for (const button of previewControls) button.disabled = true;
				const generation = requestId;
				field("add").disabled = true;
				status("Adding approved POIs… Komoot editing is temporarily paused. Close this dialog to cancel.");
				try {
					const outcome = await globalThis.KrbKomootPois.addApproved({ routeKey: snapshot.routeKey, pois: globalThis.KrbKomootPoiData.approved([...selections.values()]) });
					if (generation !== requestId || dialog.hidden) return;
					status(`${outcome.added} approved POIs added to Komoot.${outcome.skipped ? ` ${outcome.skipped} already present.` : ""}${outcome.cancelled ? " Insertion cancelled." : ""} Save the route in Komoot when ready.`);
				}
				catch (error) {
					if (generation !== requestId || dialog.hidden) return;
					status(`POI insertion stopped: ${error.message}`);
				}
				finally {
					inserting = false;
					globalThis.KrbRouteDialog?.setPaused?.(false);
					field("analyse").disabled = false;
					field("options").disabled = false;
					field("highlight-grades").disabled = false;
					for (const button of previewControls) button.disabled = button.dataset?.alreadyPresent === "true";
					if (generation === requestId && result) selectionState();
				}
			});
			field("close").addEventListener("click", function () {
				globalThis.KrbRouteDialog?.cancel();
				invalidate();
				dialog.hidden = true;
				trigger.setAttribute("aria-expanded", "false");
				trigger.focus();
			});
			dialog.addEventListener("keydown", function (event) {
				event.stopPropagation();
				if (event.key === "Escape") field("close").click();
			});
		}
		dialog.hidden = false;
		trigger.setAttribute("aria-expanded", "true");
		field("close").focus();
	}
	window.addEventListener("message", function (event) {
		if (event.source !== window || event.origin !== location.origin) return;
		if (event.data?.type === "KRB_OSM_DATA_UPDATED" && gradeData) {
			gradeData = undefined;
			invalidate("Trail data updated. Analyse again before generating POIs.", "Trail data updated — reanalyse");
		}
		if (event.data?.type === "KRB_ROUTE_CHANGED" && dialog) {
			gradeData = undefined;
			const text = event.data.reason === "poi-insertion" ? field("status").textContent : "Route changed. Analyse again before generating POIs.";
			invalidate(text, event.data.reason === "poi-insertion" ? "Route updated — reanalyse" : "Route changed — reanalyse");
		}
		if (event.data?.type !== "KRB_ROUTE_SNAPSHOT_DATA" || event.data.requestId !== `ride:${requestId}` || !controller || !awaitingSnapshot) return;
		clearTimeout(requestTimer);
		awaitingSnapshot = false;
		if (event.data.error) invalidate(event.data.error);
		else void analyse(event.data);
	});
	function attach(element) {
		panel = element;
		trigger = document.createElement("button");
		trigger.type = "button";
		trigger.className = "krb-panel__analyse";
		trigger.textContent = "Analyse route";
		trigger.setAttribute("aria-label", "Analyse route");
		trigger.setAttribute("aria-expanded", "false");
		panel.querySelector(".krb-panel__tools").append(trigger);
		trigger.addEventListener("click", function (event) {
			event.preventDefault();
			event.stopPropagation();
			open();
			field("analyse").click();
		});
	}
	globalThis.KrbRideDialog = { attach };
})();
