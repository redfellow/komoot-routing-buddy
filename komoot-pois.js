// Isolated-world approval transport. Only the page bridge edits Komoot's planner model.
(function () {
	class KomootInsertionError extends Error {
		constructor(message) {
			super(message);
			this.name = "KomootInsertionError";
		}
	}
	let routeKey, supported = false, sequence = 0, pending;
	function configure(snapshot) {
		routeKey = snapshot?.routeKey;
		supported = typeof routeKey === "string" && snapshot?.poiAvailable === true;
	}
	function available() {
		return supported && !pending;
	}
	function cancel() {
		if (pending) window.postMessage({ type: "KRB_POI_CANCEL", requestId: pending.id }, location.origin);
	}
	async function addApproved(value) {
		if (pending) throw new KomootInsertionError("Komoot is still processing the previous POI request.");
		if (!supported || value?.routeKey !== routeKey)
			throw new KomootInsertionError("Analyse the current Komoot route before adding POIs.");
		const pois = globalThis.KrbKomootPoiData.approved(value.pois),
			id = `poi:${++sequence}`;
		return await new Promise(function (resolve, reject) {
			pending = { id, resolve, reject, count: pois.length, timer: undefined };
			pending.timer = setTimeout(function () {
				// Keep the request locked: a late response may still confirm a successful mutation.
				if (pending?.id === id) reject(new KomootInsertionError("Komoot has not confirmed the result. Wait before retrying; the request may still be processing."));
			}, 120000);
			window.postMessage({ type: "KRB_POI_ADD", requestId: id, routeKey, pois }, location.origin);
		});
	}
	window.addEventListener("message", function (event) {
		if (event.source !== window || event.origin !== location.origin) return;
		if (event.data?.type === "KRB_ROUTE_CHANGED") {
			supported = false;
			cancel();
		}
		if (event.data?.type !== "KRB_POI_RESULT" || !pending || event.data.requestId !== pending.id) return;
		const request = pending,
			message = event.data;
		clearTimeout(request.timer);
		pending = undefined;
		if (typeof message.error === "string") request.reject(new KomootInsertionError(message.error));
		else if (!Number.isInteger(message.added) || !Number.isInteger(message.skipped) ||
			message.added < 0 || message.skipped < 0 || message.added + message.skipped > request.count)
			request.reject(new KomootInsertionError("Komoot returned an invalid POI result. Inspect the route before retrying."));
		else request.resolve({ added: message.added, skipped: message.skipped, cancelled: message.cancelled === true });
	});
	globalThis.KrbKomootPois = { configure, available, addApproved, cancel, KomootInsertionError };
})();
