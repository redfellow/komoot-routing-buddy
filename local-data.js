(function () {
	const api = globalThis.KrbBrowser;
	const input = document.getElementById("snapshot"), status = document.getElementById("status"), active = document.getElementById("active");
	const cancel = document.getElementById("cancel"), progress = document.getElementById("progress"), update = document.getElementById("update");
	const automatic = document.getElementById("automatic"), history = document.getElementById("history");
	const query = new URLSearchParams(location.search), bundledTab = query.get("bundled") === "1";
	const isAutomaticTab = query.get("automatic") === "1" || bundledTab;
	const phases = { download: "Downloading Finland", checksum: "Checking source integrity", prepare: "Preparing trails", compress: "Compressing spatial files", import: "Validating and installing" };
	let worker, heartbeat, resumeMode = "update", updating = false, latestPhase = "Starting update", jobQueue = Promise.resolve();
	async function refresh() {
		const store = KrbLocalOsm.create();
		try {
			const snapshot = await store.status(), saved = await api.storage.local.get(["localOsmAutoUpdate", "localOsmUpdateState"]);
			active.textContent = snapshot ? `Active Finland snapshot: ${snapshot.snapshotAt.slice(0, 10)} · ${snapshot.counts.way.toLocaleString()} ways · ${Math.round(snapshot.bytes / 1000000)} MB` : "No local snapshot installed.";
			automatic.checked = saved.localOsmAutoUpdate !== false;
			const job = saved.localOsmUpdateState;
			resumeMode = job?.error && job.mode === "bundled" ? "bundled" : "update";
			history.textContent = job?.running && Date.now() - job.heartbeat < 120000 ? `Update running: ${job.phase || "starting"}` : job?.error ? `Last update: ${job.error}` : job?.checkedAt ? `Last update check: ${new Date(job.checkedAt).toLocaleString()}` : snapshot ? "Automatic updates check for newer Finland data weekly." : "Weekly updates start after a local snapshot is installed.";
			if (!worker) update.textContent = job?.error === "Paused" ? "Resume update" : job?.error ? "Retry update" : "Update Finland data";
		}
		catch (error) { active.textContent = `Local storage unavailable: ${error.message}`; }
		finally { await store.close().catch((e) => console.warn("Local storage close:", e.message)); }
	}
	function saveJob(result) {
		const saved = jobQueue.then(async function () {
			const previous = (await api.storage.local.get("localOsmUpdateState")).localOsmUpdateState || {};
			await api.storage.local.set({ localOsmUpdateState: { ...previous, ...result } });
		});
		jobQueue = saved.catch((e) => console.warn("Update state queue:", e.message));
		return saved;
	}
	function controls(busy) { input.disabled = busy; update.disabled = busy; cancel.hidden = !busy; progress.hidden = !busy; }
	function stop() { worker?.terminate(); worker = undefined; clearInterval(heartbeat); heartbeat = undefined; controls(false); input.value = ""; }
	function start(message) {
		if (worker) return;
		updating = ["update", "bundled"].includes(message.type); worker = new Worker("local-data-worker.js"); controls(true); progress.value = 0; progress.max = 1;
		status.textContent = message.type === "bundled" ? "Importing bundled Finland data…" : updating ? "Checking the public Finland source…" : "Validating and importing Finland data…";
		if (updating) {
			void saveJob({ running: true, heartbeat: Date.now(), error: null, mode: message.type }).catch((e) => console.warn("Update status:", e.message));
			heartbeat = setInterval(function () { void saveJob({ running: true, heartbeat: Date.now(), phase: latestPhase }).catch((e) => console.warn("Update heartbeat:", e.message)); }, 15000);
		}
		worker.onmessage = async function (event) {
			const message = event.data;
			if (message.progress) {
				const p = message.progress; progress.max = p.total; progress.value = p.completed;
				latestPhase = phases[p.phase] || "Importing";
				status.textContent = ["download", "checksum", "prepare"].includes(p.phase) ? `${latestPhase}… ${Math.floor(p.completed / p.total * 100)}%` : `${latestPhase}… ${p.completed}/${p.total}${p.reused ? " · resumed" : ""}`;
				return;
			}
			const wasUpdate = updating; stop();
			status.textContent = message.error ? `Import incomplete: ${message.error}. ${wasUpdate ? "Retry to resume." : "Select the same folder to resume."}` : message.unchanged ? "The installed snapshot is up to date." : "Finland data is ready. Refresh an open map to load it.";
			if (message.cleanupWarning) status.textContent += ` ${message.cleanupWarning}`;
			try {
				if (wasUpdate) await saveJob({ running: false, error: message.error || message.cleanupWarning || null, checkedAt: Date.now(), nextCheck: Date.now() + (message.error ? 6 * 3600000 : 7 * 86400000) });
				if (!message.error && !message.unchanged && message.status?.snapshotAt) await api.storage.local.set({ localOsmSnapshotUpdatedAt: message.status.snapshotAt });
				await refresh();
				if (isAutomaticTab && !worker && !message.error && !message.cleanupWarning) { const tab = await api.tabs.getCurrent(); if (tab) await api.tabs.remove(tab.id); }
			}
			catch (error) { status.textContent += ` Could not finish update status: ${error.message}`; }
		};
		worker.onerror = function (event) {
			stop(); update.textContent = updating ? "Retry update" : "Update Finland data"; status.textContent = `Import interrupted: ${event.message}. ${updating ? "Retry to resume." : "Select the same folder to resume."}`;
			if (updating) void saveJob({ running: false, error: event.message, nextCheck: Date.now() + 6 * 3600000 }).catch((e) => console.warn("Update error status:", e.message));
		};
		worker.postMessage(message);
	}
	input.addEventListener("change", function () { if (input.files.length) start({ files: [...input.files] }); });
	update.addEventListener("click", function () {
		if (bundledTab || resumeMode === "bundled") {
			if (window.confirm("Resume importing the Finland data included with this extension? The current snapshot stays available. Continue?")) start({ type: "bundled" });
			return;
		}
		if (window.confirm("Download and prepare the latest Finland data? The source is approximately 770 MB. Preparation took about seven minutes in our desktop Chrome test, plus download time; your browser may take longer. The current snapshot stays available. Continue?")) start({ type: "update" });
	});
	cancel.addEventListener("click", function () {
		stop(); update.textContent = updating ? "Resume update" : "Update Finland data"; status.textContent = updating ? "Update paused. Retry to resume; the current snapshot is still available." : "Import paused. Select the same folder to resume; the current snapshot is still available.";
		if (updating) void saveJob({ running: false, error: "Paused", nextCheck: Date.now() + 6 * 3600000 }).catch((e) => console.warn("Pause status:", e.message));
	});
	automatic.addEventListener("change", function () { void api.storage.local.set({ localOsmAutoUpdate: automatic.checked }).catch((e) => { status.textContent = `Could not save automatic-update setting: ${e.message}`; }); });
	void refresh(); status.textContent = "Import a prepared folder or update from the public Finland source.";
	if (bundledTab) start({ type: "bundled" });
	else if (isAutomaticTab) void api.storage.local.get("localOsmAutoUpdate").then(function (saved) { if (saved.localOsmAutoUpdate !== false) start({ type: "update" }); });
})();
