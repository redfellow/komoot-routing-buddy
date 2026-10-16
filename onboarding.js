// Non-modal guidance only: navigation never invokes analysis or changes a route.
(function () {
	const steps = [
		{ title: "See the trails", text: "Turn trail colours on or off here. Expand Routing Buddy to change trail colours and settings.", anchor: ".krb-panel__toggle" },
		{ title: "Understand your ride", text: "Plan a route, then choose Analyse route for terrain, climbing and mapped warnings. Hover to highlight a section; click to zoom.", anchor: ".krb-panel__analyse" },
		{ title: "Keep useful moments", text: "Preview proposed POIs, tick the points you want and add them to your route. Save in Komoot to keep them.", anchor: ".krb-panel__analyse" },
	];
	let panel, guide, heading, copy, progress, back, next, example, anchor, previousFocus;
	let index = 0;
	let attempted = false;
	let claiming = false;
	let ready = false;
	function button(text, handler) {
		const node = document.createElement("button");
		node.type = "button";
		node.textContent = text;
		node.addEventListener("click", handler);
		return node;
	}
	function position() {
		if (!guide || guide.hidden || !anchor) return;
		const rect = anchor.getBoundingClientRect();
		const width = Math.min(360, window.innerWidth - 24);
		guide.style.width = `${width}px`;
		const height = guide.offsetHeight;
		const top = rect.bottom + 12 + height <= window.innerHeight - 12 ? rect.bottom + 12 : rect.top - height - 12;
		guide.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
		guide.style.top = `${Math.max(12, Math.min(top, window.innerHeight - height - 12))}px`;
	}
	function dismiss() {
		if (!guide || guide.hidden) return;
		guide.hidden = true;
		anchor?.classList.remove("krb-guide__anchor");
		const target = previousFocus?.isConnected && previousFocus.closest("#krb-panel") ? previousFocus : panel.querySelector(".krb-panel__analyse");
		target?.focus();
	}
	function render() {
		anchor?.classList.remove("krb-guide__anchor");
		const step = steps[index];
		anchor = panel.querySelector(step.anchor);
		if (index === 2) {
			const preview = document.querySelector('[data-ride="preview"]');
			if (preview && !preview.hidden && preview.open && preview.getBoundingClientRect().height > 0) anchor = preview.querySelector("summary");
		}
		anchor?.classList.add("krb-guide__anchor");
		heading.textContent = step.title;
		copy.textContent = step.text;
		progress.textContent = `${index + 1} of ${steps.length}`;
		back.hidden = index === 0;
		next.textContent = index === steps.length - 1 ? "Done" : "Next";
		example.hidden = index !== 2;
		position();
		heading.focus();
	}
	function show() {
		if (!ready || !panel || claiming) return false;
		previousFocus = document.activeElement;
		if (!guide) {
			guide = document.createElement("section");
			guide.className = "krb-guide";
			guide.setAttribute("role", "dialog");
			guide.setAttribute("aria-modal", "false");
			guide.setAttribute("aria-labelledby", "krb-guide-title");
			progress = document.createElement("p");
			progress.className = "krb-guide__progress";
			heading = document.createElement("h2");
			heading.id = "krb-guide-title";
			heading.className = "krb-guide__title";
			heading.tabIndex = -1;
			copy = document.createElement("p");
			copy.className = "krb-guide__copy";
			example = document.createElement("div");
			example.className = "krb-guide__example";
			example.textContent = "Example POI · Halfway";
			const controls = document.createElement("div");
			controls.className = "krb-guide__controls";
			const skip = button("Skip", dismiss);
			skip.className = "krb-guide__skip";
			back = button("Back", function () { index--; render(); });
			next = button("Next", function () {
				if (index === steps.length - 1) dismiss();
				else { index++; render(); }
			});
			next.className = "krb-guide__next";
			controls.append(skip, back, next);
			guide.append(progress, heading, copy, example, controls);
			document.documentElement.append(guide);
			window.addEventListener("keydown", function (event) {
				if (event.key === "Escape" && !guide.hidden) {
					event.preventDefault();
					event.stopImmediatePropagation();
					dismiss();
				}
			}, true);
			window.addEventListener("resize", position);
			new MutationObserver(position).observe(panel, { attributes: true, attributeFilter: ["style", "open"] });
			if (typeof ResizeObserver !== "undefined") new ResizeObserver(position).observe(guide);
		}
		guide.hidden = false;
		index = 0;
		render();
		return true;
	}
	async function setReady(value) {
		ready = value === true;
		if (!ready) dismiss();
		if (!ready || !panel || attempted) return;
		attempted = true;
		claiming = true;
		try {
			const response = await globalThis.KrbBrowser.runtime.sendMessage({ type: "KRB_CLAIM_GUIDE" });
			claiming = false;
			if (response?.show === true && ready) show();
			else if (response?.error) console.error("Routing Buddy guide:", response.error);
		}
		catch (error) {
			console.error("Routing Buddy could not initialize the guide:", error);
		}
		finally {
			claiming = false;
		}
	}
	function attach(element) {
		panel = element;
	}
	globalThis.KrbOnboarding = { attach, setReady, show };
})();
