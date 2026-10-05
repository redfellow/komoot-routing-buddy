// Short-lived background coordination; preparation itself runs in a durable extension tab.
(function () {
	const api = globalThis.KrbBrowser, week = 7 * 86400000, alarm = "krb-finland-update";
	async function schedule() {
		await api.alarms.create(alarm, { delayInMinutes: 5 + Math.random() * 55, periodInMinutes: 120 });
	}
	async function check() {
		const saved = await api.storage.local.get(["localOsmAutoUpdate", "localOsmUpdateState"]);
		const job = saved.localOsmUpdateState || {}, now = Date.now();
		if (job.running && now - job.heartbeat < 120000) return;
		const store = KrbLocalOsm.create();
		try {
			const snapshot = await store.status(), bundle = globalThis.KrbBundledOsm ? await KrbBundledOsm.create().manifest() : undefined;
			const install = bundle && (!snapshot || Date.parse(bundle.snapshotAt) > Date.parse(snapshot.snapshotAt));
			if (job.nextCheck > now && (!install || job.error && job.mode === "bundled" && job.bundleSnapshotAt === bundle.snapshotAt)) return;
			if (!install && (saved.localOsmAutoUpdate === false || !snapshot || now - Date.parse(snapshot.snapshotAt) < week)) return;
			await api.storage.local.set({ localOsmUpdateState: { ...job, running: true, heartbeat: now, mode: install ? "bundled" : "update", bundleSnapshotAt: install ? bundle.snapshotAt : null } });
			try { await api.tabs.create({ url: api.runtime.getURL(`local-data.html?${install ? "bundled" : "automatic"}=1`), active: false }); }
			catch (error) { await api.storage.local.set({ localOsmUpdateState: { running: false, error: error.message, nextCheck: now + 6 * 3600000 } }); throw error; }
		}
		finally { await store.close(); }
	}
	function report(error) { console.warn("Finland update scheduling:", error.message); }
	if (api?.alarms) {
		api.alarms.onAlarm.addListener(function (event) { if (event.name === alarm) void check().catch(report); });
		api.runtime.onInstalled.addListener(function () { void schedule().then(check).catch(report); });
		api.runtime.onStartup.addListener(function () { void schedule().then(check).catch(report); });
		// Also restore the alarm after a source-loaded extension is reloaded.
		void api.alarms.get(alarm).then(function (existing) { if (!existing) return schedule(); }).catch(report);
	}
	globalThis.KrbOsmUpdates = { check, schedule };
})();
