(function () {
	if (!/^\/(?:tour\/[^/]+\/(?:zoom|edit)|plan(?:\/.*)?)$/.test(location.pathname)) return;
	const arrows = {
		"M15.615 18.885L8.745 12l6.87-6.885L13.5 3l-9 9 9 9 2.115-2.115z": true,
		"M5.385 5.115L12.255 12l-6.87 6.885L7.5 21l9-9-9-9-2.115 2.115z": false,
	};
	let userChanged = false;
	let saveTimer;

	function readSidebar() {
		for (const path of document.querySelectorAll("button svg[viewBox=\"0 0 24 24\"] path")) {
			const shape = path.getAttribute("d");
			if (Object.hasOwn(arrows, shape)) {
				return { button: path.closest("button"), open: arrows[shape] };
			}
		}
		return null;
	}

	function rememberChange() {
		userChanged = true;
		window.clearTimeout(saveTimer);
		saveTimer = window.setTimeout(async function () {
			const sidebar = readSidebar();
			if (!sidebar) return;
			try {
				await globalThis.KrbBrowser.storage.local.set({ sidebarOpen: sidebar.open });
			}
			catch (error) {
				console.error("Routing Buddy could not save sidebar state:", error);
			}
		}, 0);
	}

	document.addEventListener(
		"click",
		function (event) {
			if (event.isTrusted && readSidebar()?.button.contains(event.target)) rememberChange();
		},
		true,
	);
	document.addEventListener(
		"keydown",
		function (event) {
			if (
				!event.isTrusted ||
				event.repeat ||
				event.ctrlKey ||
				event.metaKey ||
				event.altKey ||
				event.key.toLowerCase() !== "h"
			)
				return;
			if (
				event.target.closest(
					"input, textarea, select, [contenteditable]:not([contenteditable=\"false\"])",
				)
			)
				return;
			rememberChange();
		},
		true,
	);

	async function restore() {
		try {
			const saved = await globalThis.KrbBrowser.storage.local.get("sidebarOpen");
			let attempts = 0;
			let clicked = false;
			const timer = window.setInterval(function () {
				if (userChanged || ++attempts > 40) {
					window.clearInterval(timer);
					return;
				}
				const sidebar = readSidebar();
				if (!sidebar) return;
				if (typeof saved.sidebarOpen !== "boolean") {
					window.clearInterval(timer);
					rememberChange();
				}
				else if (sidebar.open === saved.sidebarOpen) {
					window.clearInterval(timer);
				}
				else if (!clicked) {
					clicked = true;
					sidebar.button.click();
				}
			}, 250);
		}
		catch (error) {
			console.error("Routing Buddy could not restore sidebar state:", error);
		}
	}
	restore();
})();
