globalThis.KrbBrowser.runtime.onMessage.addListener(function (message, sender, sendResponse) {
	if (message?.type !== "KRB_OPEN_SETTINGS" || sender.id !== globalThis.KrbBrowser.runtime.id || !sender.tab) return;
	openSettings(sender.tab.windowId, sendResponse);
	return true;
});

async function openSettings(windowId, sendResponse) {
	try {
		await globalThis.KrbBrowser.action.openPopup({ windowId });
		sendResponse({ ok: true });
	}
	catch (error) {
		sendResponse({ ok: false, error: error.message });
	}
}

globalThis.KrbBrowser.runtime.onMessage.addListener(function (message, sender, sendResponse) {
	if (message?.type !== "KRB_LOAD_HAZARDS" || sender.id !== globalThis.KrbBrowser.runtime.id || !sender.tab) return;
	if (!/^https:\/\/www\.komoot\.com\/(?:tour\/[^/]+\/(?:zoom|edit)|plan(?:\/[^?]*)?)(?:\?.*)?$/.test(sender.url || "")) return;
	globalThis.KrbBrowser.storage.sync.get("trailOptions").then(function (saved) {
		if (saved.trailOptions?.showHazards === false) throw new Error("Hazards disabled");
		if (message.prefetch && saved.trailOptions?.preloadRouteHazards !== true) throw new Error("Route preload disabled");
		return globalThis.KrbHazards.load(message.bounds, message.prefetch === true);
	}).then((data) => sendResponse({ data })).catch((error) => sendResponse({ error: error.message, retryMs: error.retryMs, status: error.status, exhausted: error.exhausted }));
	return true;
});


globalThis.KrbBrowser.runtime.onMessage.addListener(function (message, sender, sendResponse) {
	if (message?.type !== "KRB_CLEAR_OSM_CACHE" || sender.id !== globalThis.KrbBrowser.runtime.id) return;
	globalThis.KrbHazards.clearCache().then(() => sendResponse({ ok: true }))
		.catch((error) => sendResponse({ ok: false, error: error.message }));
	return true;
});

// Explicit checks are independent of display/preload preferences.
globalThis.KrbBrowser.runtime.onMessage.addListener(function (message, sender, sendResponse) {
	if (message?.type !== "KRB_CHECK_AREA" || sender.id !== globalThis.KrbBrowser.runtime.id || !sender.tab) return;
	if (!/^https:\/\/www\.komoot\.com\/(?:tour\/[^/]+\/(?:zoom|edit)|plan(?:\/[^?]*)?)(?:\?.*)?$/.test(sender.url || "")) return;
	globalThis.KrbHazards.loadRoute(message.bounds).then((data) => sendResponse({ data }))
		.catch((error) => sendResponse({ error: error.message, retryMs: error.retryMs, status: error.status, permanent: error.permanent }));
	return true;
});
