// Inline trail checks share the route analysis panel; retries retain completed areas.
(function () {
	const checker = globalThis.KrbRouteCheck, warningButtons = [];
	let paused = false,
		onData,
		onState,
		dialog,
		run,
		route,
		routeKey,
		requestId = 0,
		requestTimer,
		retryTimer;
	let preferences = checker.preferences();
	let collected = [],
		failed = false,
		checkpoint = {},
		refreshing = false;
	function post(message) {
		window.postMessage(message, location.origin);
	}
	function field(name) {
		return dialog.querySelector(`[data-route="${name}"]`);
	}
	function state(phase, details = {}) {
		onState?.({ phase, ...details });
	}
	function clearRetryTimer() {
		clearTimeout(retryTimer);
		retryTimer = undefined;
	}
	function showProgress(progress) {
		clearRetryTimer();
		const percent = progress.total ? Math.floor((progress.completed / progress.total) * 100) : 0;
		state("checking", { percent });
		field("status").textContent = `Checking trails… ${percent}%`;
		field("bar").setAttribute("aria-valuenow", String(percent));
		field("bar").setAttribute(
			"aria-valuetext",
			`${progress.completed} of ${progress.total} areas checked`,
		);
		field("fill").style.width = `${percent}%`;
		field("counts").textContent =
			`${progress.completed}/${progress.total} areas · ${progress.cached} cached · ${progress.downloaded} downloaded`;
		field("activity").textContent =
			progress.completed === progress.total
				? "Analysing matched trails…"
				: `Checking next areas… ${progress.running || 0} active check${progress.running === 1 ? "" : "s"}`;
	}
	function showRetry(value) {
		clearRetryTimer();
		const deadline = Date.now() + value.retryMs;
		function tick() {
			const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
			field("activity").textContent = seconds
				? `OSM temporarily unavailable — retrying automatically in ${seconds}s…`
				: "Retrying OSM request…";
			if (seconds) retryTimer = setTimeout(tick, 1000);
		}
		tick();
	}
	function busy(value) {
		if (!value) clearRetryTimer();
		field("progress").hidden = !value;
		field("retry").disabled = value || paused;
		field("retry").hidden = value || !failed;
		field("refresh").disabled = value || paused;
		field("cancel").hidden = !value;
		field("preferences").disabled = value || paused;
		field("results").setAttribute("aria-busy", String(value));
	}
	function stop(text, phase = "incomplete") {
		clearTimeout(requestTimer);
		requestId++;
		if (run) failed = true;
		run?.abort();
		run = undefined;
		post({ type: "KRB_ROUTE_CHECK_ACTIVE", active: false });
		if (!dialog) return;
		busy(false);
		if (text) {
			field("status").textContent = text;
			state(phase);
		}
	}
	function render(incomplete = false) {
		if (!route) return;
		const result = checker.analyse(route, collected, preferences);
		field("results").replaceChildren();
		warningButtons.length = 0;
		for (const warning of result.warnings) {
			const item = document.createElement("li"),
				button = document.createElement("button");
			button.type = "button";
			button.disabled = paused;
			warningButtons.push(button);
			button.textContent = `${(warning.distance / 1000).toFixed(2)}km — ${warning.text}`;
			button.addEventListener("click", function () {
				if (paused) return;
				post({
					type: "KRB_ROUTE_FOCUS",
					routeKey,
					point: warning.point,
					coordinates: warning.coordinates,
				});
			});
			item.append(button);
			field("results").append(item);
		}
		field("source").textContent = [
			checkpoint.localSnapshotAt
				? `Local Finland snapshot: ${checkpoint.localSnapshotAt.slice(0, 10)}`
				: "",
			checkpoint.refreshedAt ? `Route data refreshed: ${checkpoint.refreshedAt.slice(0, 10)}` : "",
		]
			.filter(Boolean)
			.join(" · ");
		const missing = result.unknown;
		field("unknown").textContent = [
			missing.surface > 1
				? `Surface missing: ${(missing.surface / 1000).toFixed(1)} km`
				: "",
			missing.rating > 1
				? `MTB grade missing: ${(missing.rating / 1000).toFixed(1)} km`
				: "",
			missing.width > 1
				? `Width missing: ${(missing.width / 1000).toFixed(1)} km`
				: "",
		]
			.filter(Boolean)
			.join(" · ");
		field("gaps").hidden = !field("unknown").textContent;
		field("status").textContent = incomplete
			? "Trail check incomplete"
			: result.warnings.length
				? `${result.warnings.length} trail warning${result.warnings.length === 1 ? "" : "s"}`
				: result.checkedDistance > 0
					? checker.SUCCESS
					: "No matched MTB-rated OSM trails to assess.";
		onData?.({ routeKey, features: collected, warnings: result.warnings, distance: result.distance, incomplete });
		state(incomplete ? "incomplete" : "ready", { count: result.warnings.length, assessed: result.checkedDistance, gaps: Boolean(field("unknown").textContent) });
	}
	async function check(snapshot, key, controller) {
		try {
			if (!controller.resume || routeKey !== key) checkpoint = {};
			field("source").textContent = "";
			route = snapshot;
			routeKey = key;
			checker.lines(route);
			collected = checkpoint.features || [];
			await globalThis.KrbBrowser.storage.sync.set({ routeCheckPreferences: preferences });
			controller.signal.throwIfAborted();
			collected = await checker.collectWithRetry(
				route,
				function (bounds, following) {
					return globalThis.KrbBrowser.runtime.sendMessage({
						type: "KRB_CHECK_AREA",
						bounds,
						following,
						refresh: refreshing,
					});
				},
				{
					signal: controller.signal,
					checkpoint,
					concurrency: 2,
					localLoad: refreshing
						? undefined
						: function (bounds) {
								return globalThis.KrbBrowser.runtime.sendMessage({
									type: "KRB_CHECK_LOCAL_ROUTE",
									bounds,
								});
							},
					waiting: function (value) {
						showRetry(value);
					},
					progress: function (progress) {
						collected = progress.features;
						showProgress(progress);
					},
				},
			);
			controller.signal.throwIfAborted();
			failed = false;
			render();
			if (refreshing) post({ type: "KRB_RELOAD_HAZARDS" });
		}
		catch (error) {
			if (controller.signal.aborted) return;
			failed = true;
			if (error.features) collected = error.features;
			try {
				render(true);
			}
			catch (renderError) {
				console.debug("Route check has no analysable snapshot:", renderError.message);
			}
			field("status").textContent =
				`Trail check incomplete — ${error.message}${error.retryMs ? `. Retry in ${Math.ceil(error.retryMs / 1000)}s.` : ""}`;
		}
		finally {
			if (run === controller) {
				run = undefined;
				busy(false);
				field("retry").textContent = "Retry check";
				post({ type: "KRB_ROUTE_CHECK_ACTIVE", active: false });
			}
		}
	}
	function start() {
		if (paused) return;
		stop();
		preferences = checker.preferences({
			maximumLevel: field("level").value,
			minimumWidth: Number(field("width").value),
			allowHazards: field("hazards").checked,
		});
		run = new AbortController();
		run.resume = failed;
		if (!run.resume) {
			route = undefined;
			collected = [];
			checkpoint = {};
			field("results").replaceChildren();
			field("unknown").textContent = "";
			field("gaps").hidden = true;
		}
		busy(true);
		showProgress({ completed: 0, total: 0, cached: 0, downloaded: 0 });
		field("status").textContent = "Reading Komoot route…";
		state("reading");
		field("counts").textContent = "";
		field("activity").textContent = "Preparing trail check…";
		post({ type: "KRB_ROUTE_CHECK_ACTIVE", active: true });
		post({ type: "KRB_ROUTE_SNAPSHOT", requestId: `check:${requestId}` });
		requestTimer = setTimeout(function () {
			stop("Trail check incomplete — map did not respond. Try again.");
		}, 5000);
	}
	async function mount(container, callback, stateCallback) {
		if (dialog) return;
		onData = callback;
		onState = stateCallback;
		dialog = document.createElement("section");
		dialog.className = "krb-ride__checks";
		dialog.setAttribute("aria-labelledby", "krb-check-title");
		dialog.innerHTML = `
			<div class="krb-ride__section-heading"><h3 id="krb-check-title">Trail checks</h3><span class="krb-ride__tag">OSM</span></div>
			<p class="krb-ride__muted">Find mapped hazards and trails beyond your difficulty or width limits.</p>
			<div class="krb-ride__check-actions">
				<button class="krb-ride__button krb-ride__button--secondary" type="button" data-route="retry" hidden>Retry check</button>
				<button class="krb-ride__button krb-ride__button--secondary" type="button" data-route="cancel" hidden>Cancel check</button>
			</div>
			<p class="krb-ride__check-status" data-route="status" role="status" aria-live="polite">Trail checks run with route analysis. Missing OSM data stays unknown.</p>
			<div class="krb-route__progress" data-route="progress" hidden>
				<div class="krb-route__bar" data-route="bar" role="progressbar" aria-label="Trail data areas checked" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="krb-route__fill" data-route="fill"></span></div>
				<p class="krb-ride__source" data-route="counts"></p>
				<p class="krb-ride__source" data-route="activity"></p>
			</div>
			<ol data-route="results" class="krb-ride__warnings" hidden></ol>
			<details class="krb-ride__notice" data-route="gaps" hidden><summary>OSM data gaps</summary><p data-route="unknown"></p></details>
			<p class="krb-ride__source" data-route="source"></p>
			<details class="krb-ride__check-settings"><summary>Check settings & data</summary>
				<fieldset data-route="preferences"><legend class="krb-ride__sr-only">Trail check limits</legend>
					<label>Maximum trail level <select data-route="level"></select></label>
					<label>Minimum trail width <output data-route="width-value">0.4 m</output><input data-route="width" type="range" min="0.1" max="1" step="0.1" value="0.4" /></label>
					<label class="krb-ride__check-checkbox"><input data-route="hazards" type="checkbox" /> Ignore mud, vegetation & obstacles</label>
				</fieldset>
				<p class="krb-ride__source">Checks MTB-rated, unpaved trails. Roads, streets, cycleways and paved paths are excluded; uncertain matches are not checked. Difficulty and width limits still apply when hazards are ignored.</p>
				<button class="krb-ride__button krb-ride__button--secondary" type="button" data-route="refresh">Update route data from OSM</button>
				<p class="krb-ride__source"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a></p>
			</details>`;
		container.append(dialog);
		for (let level = 0; level <= 5; level++) {
			const option = document.createElement("option");
			option.value = `S${level}`;
			option.textContent = option.value;
			field("level").append(option);
		}
		try {
			const saved = await globalThis.KrbBrowser.storage.sync.get("routeCheckPreferences");
			preferences = checker.preferences(saved.routeCheckPreferences);
		}
		catch (error) {
			console.warn("Could not read route preferences:", error);
		}
		field("level").value = preferences.maximumLevel;
		field("width").value = String(preferences.minimumWidth);
		field("width-value").textContent = `${preferences.minimumWidth.toFixed(1)} m`;
		field("hazards").checked = preferences.allowHazards;
		field("width").addEventListener("input", function () {
			field("width-value").textContent = `${Number(field("width").value).toFixed(1)} m`;
		});
		field("preferences").addEventListener("change", async function () {
			preferences = checker.preferences({ maximumLevel: field("level").value, minimumWidth: Number(field("width").value), allowHazards: field("hazards").checked });
			try {
				await globalThis.KrbBrowser.storage.sync.set({ routeCheckPreferences: preferences });
			}
			catch (error) {
				field("status").textContent = `Could not save preferences: ${error.message}`;
				return;
			}
			if (route && !run) render(failed);
		});
		field("retry").addEventListener("click", function () {
			if (!failed) refreshing = false;
			start();
		});
		field("refresh").addEventListener("click", function () {
			if (paused) return;
			refreshing = true;
			failed = false;
			checkpoint = {};
			start();
		});
		field("cancel").addEventListener("click", cancel);
		busy(false);
		state("idle");
	}
	function cancel() {
		if (!run) return;
		stop("Trail check cancelled. Completed areas remain cached.", "cancelled");
		failed = true;
		field("retry").textContent = "Retry check";
	}

	window.addEventListener("message", function (event) {
		if (event.source !== window || event.origin !== location.origin) return;
		const message = event.data;
		if (
			message?.type === "KRB_ROUTE_SNAPSHOT_DATA" &&
			message.requestId === `check:${requestId}` &&
			run &&
			!run.snapshotReceived
		) {
			clearTimeout(requestTimer);
			run.snapshotReceived = true;
			if (message.error) {
				stop(`Trail check incomplete — ${message.error}`);
				return;
			}
			void check(message.route, message.routeKey, run);
		}
		if (["KRB_ROUTE_CHANGED", "KRB_OSM_DATA_UPDATED"].includes(message?.type) && (route || run)) {
			stop(
				message.type === "KRB_ROUTE_CHANGED"
					? "Trail results outdated — reanalyse."
					: "OSM data updated — reanalyse to update trail checks.",
				"stale",
			);
			route = undefined;
			collected = [];
			checkpoint = {};
			refreshing = false;
			field("results").replaceChildren();
			field("unknown").textContent = "";
			field("gaps").hidden = true;
			field("retry").hidden = true;
		}
	});
	function setPaused(value) {
		paused = value;
		for (const button of warningButtons) button.disabled = value;
		if (dialog) busy(Boolean(run));
	}
	globalThis.KrbRouteDialog = { mount, start, cancel, setPaused };
})();
