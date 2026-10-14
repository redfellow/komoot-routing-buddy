import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function worker({ seen = false, fail = false } = {}) {
	const listeners = [], writes = [];
	const api = {
		runtime: { id: "buddy", onMessage: { addListener(listener) { listeners.push(listener); } } },
		storage: { local: {
			async get() { return { quickGuideSeen: seen }; },
			async set(value) {
				if (fail) throw new Error("Storage unavailable");
				writes.push(value);
				seen = value.quickGuideSeen;
			},
		} },
	};
	runInNewContext(readFileSync("background.js", "utf8"), { KrbBrowser: api });
	const listener = listeners.at(-1);
	function claim(sender = { id: "buddy", tab: { id: 1 }, url: "https://www.komoot.com/plan" }) {
		return new Promise(function (resolve) {
			const pending = listener({ type: "KRB_CLAIM_GUIDE" }, sender, resolve);
			if (!pending) resolve(undefined);
		});
	}
	return { claim, writes };
}

test("only one concurrent tab receives the guide and the marker is persisted first", async function () {
	const f = worker();
	const result = await Promise.all([f.claim(), f.claim(), f.claim()]);
	assert.deepEqual(result.map((value) => value.show), [true, false, false]);
	assert.equal(f.writes.length, 1);
	assert.equal(f.writes[0].quickGuideSeen, true);
});
test("seen guides remain suppressed after worker restart", async function () {
	assert.equal((await worker({ seen: true }).claim()).show, false);
});
test("untrusted senders and unrelated pages cannot consume the marker", async function () {
	const f = worker();
	assert.equal(await f.claim({ id: "other", tab: {}, url: "https://www.komoot.com/plan" }), undefined);
	assert.equal(await f.claim({ id: "buddy", tab: {}, url: "https://www.komoot.com/account" }), undefined);
	assert.equal(await f.claim({ id: "buddy", url: "https://www.komoot.com/plan" }), undefined);
	assert.equal(f.writes.length, 0);
	assert.equal((await f.claim()).show, true);
});
test("failed storage does not show an unrecorded guide or poison the claim queue", async function () {
	const f = worker({ fail: true });
	for (let i = 0; i < 2; i++) {
		const result = await f.claim();
		assert.equal(result.show, false);
		assert.match(result.error, /Storage unavailable/);
	}
});

function ui() {
	const events = {}, children = [], sent = [];
	let focused;
	function element(tag = "section") {
		return {
			tag, hidden: false, children: [], attributes: {}, style: {}, isConnected: true, offsetHeight: 260,
			classList: { add() {}, remove() {} },
			setAttribute(name, value) { this.attributes[name] = value; },
			addEventListener(name, handler) { this[name] = handler; },
			append(...nodes) { this.children.push(...nodes); },
			getBoundingClientRect() { return { left: 80, top: 40, bottom: 84, height: 44 }; },
			focus() { focused = this; },
			closest() { return null; },
		};
	}
	const toggle = element("button"), analyse = element("button");
	const panel = element();
	panel.querySelector = (selector) => selector === ".krb-panel__toggle" ? toggle : analyse;
	const context = {
		console, MutationObserver: class { observe() {} },
		window: { innerWidth: 390, innerHeight: 844, addEventListener(name, handler) { events[name] = handler; } },
		document: { activeElement: analyse, createElement: element, querySelector() { return null; }, documentElement: { append(node) { children.push(node); } } },
		KrbBrowser: { runtime: { async sendMessage(message) { sent.push(message); return { show: true }; } } },
	};
	runInNewContext(readFileSync("onboarding.js", "utf8"), context);
	context.KrbOnboarding.attach(panel);
	return { guide: context.KrbOnboarding, sent, children, events, focused: () => focused };
}
test("guide waits for readiness, supports all steps and replay without another claim or route action", async function () {
	const f = ui();
	await f.guide.setReady(false);
	assert.equal(f.sent.length, 0);
	await f.guide.setReady(true);
	assert.equal(f.sent.length, 1);
	const card = f.children[0], [progress, heading, copy, example, controls] = card.children;
	const [skip, back, next] = controls.children;
	assert.equal(heading.textContent, "See the trails");
	assert.equal(back.hidden, true);
	next.click();
	assert.equal(heading.textContent, "Understand your ride");
	assert.equal(back.hidden, false);
	back.click();
	assert.equal(progress.textContent, "1 of 3");
	next.click(); next.click();
	assert.equal(heading.textContent, "Keep useful moments");
	assert.equal(example.hidden, false);
	assert.equal(next.textContent, "Done");
	next.click();
	assert.equal(card.hidden, true);
	await f.guide.setReady(true);
	assert.equal(card.hidden, true);
	assert.equal(f.guide.show(), true);
	assert.equal(card.hidden, false);
	assert.equal(progress.textContent, "1 of 3");
	skip.click();
	assert.equal(card.hidden, true);
	assert.deepEqual(f.sent.map((message) => message.type), ["KRB_CLAIM_GUIDE"]);
});
test("Escape dismisses, restores focus and stops other dialogs handling the same Escape", async function () {
	const f = ui();
	await f.guide.setReady(true);
	let stopped = false;
	f.events.keydown({ key: "Escape", preventDefault() {}, stopImmediatePropagation() { stopped = true; } });
	assert.equal(f.children[0].hidden, true);
	assert.equal(stopped, true);
	assert.equal(f.focused().tag, "button");
	await f.guide.setReady(false);
	assert.equal(f.guide.show(), false);
});
