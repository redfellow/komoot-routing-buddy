(function () {
	const checker = globalThis.KrbRouteCheck;
	let dialog, trigger, panel, run, route, routeKey, requestId = 0, requestTimer, retryTimer;
	let preferences = checker.preferences();
	let collected = [], failed = false, checkpoint = {};
	function post(message) { window.postMessage(message, location.origin); }
	function field(name) { return dialog.querySelector(`[data-route="${name}"]`); }
	function position() {
		if (!dialog || dialog.hidden) return;
		const rect = panel.getBoundingClientRect();
		const width = Math.min(390, window.innerWidth - 16);
		dialog.style.width = `${width}px`;
		dialog.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
		const height = dialog.offsetHeight;
		dialog.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - height - 8))}px`;
	}
	function clearRetryTimer() { clearTimeout(retryTimer); retryTimer = undefined; }
	function showProgress(progress) {
		clearRetryTimer();
		const percent = progress.total ? Math.floor(progress.completed / progress.total * 100) : 0;
		field("status").textContent = `Checking trails… ${percent}%`;
		field("bar").setAttribute("aria-valuenow", String(percent));
		field("bar").setAttribute("aria-valuetext", `${progress.completed} of ${progress.total} areas checked`);
		field("fill").style.width = `${percent}%`;
		field("counts").textContent = `${progress.completed}/${progress.total} areas · ${progress.cached} cached · ${progress.downloaded} downloaded`;
		field("activity").textContent = progress.completed === progress.total ? "Analysing matched trails…" : `Checking next areas… ${progress.running || 0} active check${progress.running === 1 ? "" : "s"}`;
	}
	function showRetry(value) {
		clearRetryTimer();
		const deadline = Date.now() + value.retryMs;
		function tick() {
			const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
			field("activity").textContent = seconds ? `OSM temporarily unavailable — retrying automatically in ${seconds}s…` : "Retrying OSM request…";
			if (seconds) retryTimer = setTimeout(tick, 1000);
		}
		tick();
	}
	function busy(value) {
		if (!value) clearRetryTimer();
		field("progress").hidden = !value;
		field("start").disabled = value;
		field("cancel").hidden = !value;
		field("preferences").disabled = value;
		field("results").setAttribute("aria-busy", String(value));
	}
	function stop(text) {
		clearTimeout(requestTimer);
		requestId++;
		if (run) failed = true;
		run?.abort(); run = undefined;
		post({ type: "KRB_ROUTE_CHECK_ACTIVE", active: false });
		if (!dialog) return;
		busy(false);
		if (text) field("status").textContent = text;
	}
	function render(incomplete = false) {
		if (!route) return;
		const result = checker.analyse(route, collected, preferences);
		field("results").replaceChildren();
		for (const warning of result.warnings) {
			const item = document.createElement("li"), button = document.createElement("button");
			button.type = "button";
			button.textContent = `${(warning.distance / 1000).toFixed(2)}km — ${warning.text}`;
			button.addEventListener("click", function () { post({ type: "KRB_ROUTE_FOCUS", routeKey, point: warning.point, coordinates: warning.coordinates }); });
			item.append(button); field("results").append(item);
		}
		const missing = result.unknown;
		field("unknown").textContent = [missing.surface > 1 ? `${(missing.surface / 1000).toFixed(2)}km of paths has an unknown surface (not assessed)` : "", missing.rating > 1 ? `${(missing.rating / 1000).toFixed(2)}km of unpaved paths has no MTB scale (unknown)` : "", missing.width > 1 ? `${(missing.width / 1000).toFixed(2)}km of MTB-rated unpaved trails has no width data` : ""].filter(Boolean).join(" · ");
		field("status").textContent = incomplete ? "Trail check incomplete" : result.warnings.length ? `${result.warnings.length} trail warning${result.warnings.length === 1 ? "" : "s"}` : result.checkedDistance > 0 ? checker.SUCCESS : "No MTB-rated unpaved trails were identified on this route.";
		position();
	}
	async function check(snapshot, key, controller) {
		try {
			if (!controller.resume || routeKey !== key) checkpoint = {};
			route = snapshot; routeKey = key;
			checker.lines(route);
			collected = checkpoint.features || [];
			await globalThis.KrbBrowser.storage.sync.set({ routeCheckPreferences: preferences });
			controller.signal.throwIfAborted();
			collected = await checker.collectWithRetry(route, function (bounds, following) {
				return globalThis.KrbBrowser.runtime.sendMessage({ type: "KRB_CHECK_AREA", bounds, following });
			}, { signal: controller.signal, checkpoint, concurrency: 2, waiting: function (value) {
				showRetry(value);
				position();
			}, progress: function (progress) {
				collected = progress.features;
				showProgress(progress);
				position();
			} });
			controller.signal.throwIfAborted();
			failed = false; render();
		}
		catch (error) {
			if (controller.signal.aborted) return;
			failed = true;
			if (error.features) collected = error.features;
			try { render(true); }
			catch (renderError) { console.debug("Route check has no analysable snapshot:", renderError.message); }
			field("status").textContent = `Trail check incomplete — ${error.message}${error.retryMs ? `. Retry in ${Math.ceil(error.retryMs / 1000)}s.` : ""}`;
		}
		finally {
			if (run === controller) {
				run = undefined; busy(false);
				field("start").textContent = failed ? "Retry" : "Check trails";
				post({ type: "KRB_ROUTE_CHECK_ACTIVE", active: false });
				position();
			}
		}
	}
	function start() {
		stop();
		preferences = checker.preferences({ maximumLevel: field("level").value, minimumWidth: Number(field("width").value), allowHazards: field("hazards").checked });
		run = new AbortController();
		run.resume = failed;
		if (!run.resume) {
			route = undefined; collected = []; checkpoint = {};
			field("results").replaceChildren(); field("unknown").textContent = "";
		}
		busy(true); showProgress({ completed: 0, total: 0, cached: 0, downloaded: 0 });
		field("status").textContent = "Reading Komoot route…";
		field("counts").textContent = "";
		field("activity").textContent = "Preparing trail check…";
		post({ type: "KRB_ROUTE_CHECK_ACTIVE", active: true });
		post({ type: "KRB_ROUTE_SNAPSHOT", requestId });
		requestTimer = setTimeout(function () { stop("Trail check incomplete — map did not respond. Try again."); }, 5000);
	}
	function open() {
		if (!dialog) {
			dialog = document.createElement("section");
			dialog.id = "krb-route-dialog"; dialog.className = "krb-route";
			dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-labelledby", "krb-route-title");
			dialog.innerHTML = `<button type="button" class="krb-settings__close" data-route="close" aria-label="Close trail checker">×</button><h2 id="krb-route-title">Check trails along route</h2><p class="krb-route__help">Checks unpaved trails with an MTB scale. Roads, streets and cycleways are excluded. Unpaved paths without an MTB scale are listed as unknown. Unmatched sections and paths without a known unpaved surface are not assessed.</p><fieldset data-route="preferences"><label>Maximum trail level<select data-route="level">${[0, 1, 2, 3, 4, 5].map((n) => `<option value="S${n}">S${n}</option>`).join("")}</select></label><label>Minimum trail width <output data-route="width-value">0.4m</output><input data-route="width" type="range" min="0.1" max="1" step="0.1" value="0.4"></label><label class="krb-route__checkbox"><input data-route="hazards" type="checkbox"> Allow hazards</label><p class="krb-route__help">Allow hazards ignores mud, vegetation and obstacles. Difficulty and minimum width still apply.</p></fieldset><div class="krb-route__actions"><button type="button" data-route="start">Check trails</button><button type="button" data-route="cancel" hidden>Cancel</button></div><p data-route="status" role="status" aria-live="polite">Check MTB-rated unpaved trails along your Komoot route using OSM data.</p><div class="krb-route__progress" data-route="progress" hidden><div class="krb-route__bar" data-route="bar" role="progressbar" aria-label="Trail data areas checked" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="krb-route__fill" data-route="fill"></span></div><p class="krb-route__help" data-route="counts"></p><p class="krb-route__help" data-route="activity"></p></div><p class="krb-route__help" data-route="unknown"></p><ol data-route="results" class="krb-route__results"></ol><a class="krb-route__help" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>`;
			document.documentElement.append(dialog);
			field("level").value = preferences.maximumLevel;
			field("width").value = String(preferences.minimumWidth);
			field("width-value").textContent = `${preferences.minimumWidth.toFixed(1)}m`;
			field("hazards").checked = preferences.allowHazards;
			field("width").addEventListener("input", function () { field("width-value").textContent = `${Number(field("width").value).toFixed(1)}m`; });
			field("preferences").addEventListener("change", function () {
				preferences = checker.preferences({ maximumLevel: field("level").value, minimumWidth: Number(field("width").value), allowHazards: field("hazards").checked });
				globalThis.KrbBrowser.storage.sync.set({ routeCheckPreferences: preferences }).catch((error) => { field("status").textContent = `Could not save preferences: ${error.message}`; });
				if (route) render(failed);
			});
			field("start").addEventListener("click", start);
			field("cancel").addEventListener("click", function () { stop("Trail check cancelled. Completed areas remain cached."); failed = true; field("start").textContent = "Retry"; });
			function close() { stop(run ? "Trail check cancelled. Completed areas remain cached." : undefined); dialog.hidden = true; trigger.setAttribute("aria-expanded", "false"); trigger.focus(); }
			field("close").addEventListener("click", close);
			dialog.addEventListener("keydown", function (event) { event.stopPropagation(); if (event.key === "Escape") close(); });
			new MutationObserver(position).observe(panel, { attributes: true, attributeFilter: ["style", "open"] });
			window.addEventListener("resize", position);
		}
		dialog.hidden = false;
		trigger.setAttribute("aria-expanded", "true");
		position(); field("level").focus();
	}
	window.addEventListener("message", function (event) {
		if (event.source !== window || event.origin !== location.origin) return;
		const message = event.data;
		if (message?.type === "KRB_ROUTE_SNAPSHOT_DATA" && message.requestId === requestId && run && !run.snapshotReceived) {
			clearTimeout(requestTimer);
			run.snapshotReceived = true;
			if (message.error) { stop(`Trail check incomplete — ${message.error}`); return; }
			void check(message.route, message.routeKey, run);
		}
		if (message?.type === "KRB_ROUTE_CHANGED" && (route || run)) {
			stop("Route changed — trail results are outdated. Check trails again.");
			route = undefined; collected = []; checkpoint = {};
			field("results").replaceChildren(); field("unknown").textContent = "";
			field("start").textContent = "Check trails";
		}
	});
	function attach(element) {
		panel = element;
		trigger = document.createElement("button");
		trigger.type = "button"; trigger.className = "krb-panel__settings krb-panel__route";
		trigger.setAttribute("aria-label", "Check trails"); trigger.setAttribute("aria-expanded", "false"); trigger.title = "Check trails";
		trigger.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="m15.4 15.4 5.1 5.1"/><path d="M10 5.7 14.2 13H5.8Z" stroke-width="1.2" stroke-linejoin="round"/><path d="M10 8.3v1.8" stroke-width="1.3"/><circle cx="10" cy="11.6" r=".65" fill="currentColor" stroke="none"/></svg>`;
		panel.querySelector(".krb-panel__settings").before(trigger);
		trigger.addEventListener("click", async function (event) {
			event.preventDefault(); event.stopPropagation();
			if (dialog && !dialog.hidden) { field("close").click(); return; }
			try { const saved = await globalThis.KrbBrowser.storage.sync.get("routeCheckPreferences"); preferences = checker.preferences(saved.routeCheckPreferences); }
			catch (error) { console.warn("Could not read route preferences:", error); }
			open();
		});
	}
	globalThis.KrbRouteDialog = { attach };
})();
