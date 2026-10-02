(function () {
	const input = document.getElementById("snapshot"), status = document.getElementById("status"), active = document.getElementById("active");
	const cancel = document.getElementById("cancel"), progress = document.getElementById("progress");
	let worker;
	async function refresh() {
		const store = KrbLocalOsm.create();
		try {
			const snapshot = await store.status();
			active.textContent = snapshot ? `Active Finland snapshot: ${snapshot.snapshotAt.slice(0, 10)} · ${snapshot.counts.way.toLocaleString()} ways` : "No local snapshot installed.";
		}
		catch (error) { active.textContent = `Local storage unavailable: ${error.message}`; }
		finally {
			try { await store.close(); }
			catch (error) { console.warn("Local storage close failed:", error.message); }
		}
	}
	function stop() { worker?.terminate(); worker = undefined; input.disabled = false; input.value = ""; cancel.hidden = true; }
	input.addEventListener("change", function () {
		if (!input.files.length || worker) return;
		worker = new Worker("local-data-worker.js"); input.disabled = true; cancel.hidden = false; progress.hidden = false; progress.value = 0;
		status.textContent = "Validating and importing Finland data…";
		worker.onmessage = function (event) {
			const message = event.data;
			if (message.progress) {
				progress.max = message.progress.total; progress.value = message.progress.completed;
				status.textContent = `Importing ${message.progress.completed}/${message.progress.total} files${message.progress.reused ? " · resumed" : ""}`;
			}
			else {
				status.textContent = message.error ? `Import incomplete: ${message.error}. Select the folder again to retry.` : "Finland data is ready for map hazards and trail checking. Refresh an open map to load it.";
				stop(); refresh();
			}
		};
		worker.onerror = function (event) { status.textContent = `Import interrupted: ${event.message}. Select the folder again to resume.`; stop(); refresh(); };
		worker.postMessage({ files: [...input.files] });
	});
	cancel.addEventListener("click", function () { stop(); status.textContent = "Import cancelled. Select the same folder to resume."; refresh(); });
	refresh(); status.textContent = "Select a prepared snapshot folder to import or resume.";
})();
