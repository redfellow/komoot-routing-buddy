import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const matches = manifest.content_scripts[0].matches.map(function (pattern) {
	return new RegExp(
		"^" +
			pattern
				.split("*")
				.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
				.join(".*") +
			"$",
	);
});

function scriptAllows(file, pathname) {
	const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
	const guard = source.match(/if\s*\([\s\S]*?location\.pathname[\s\S]*?\)\s*return;/)?.[0];
	assert.ok(guard, `Missing page guard in ${file}`);
	const context = { location: { pathname }, allowed: false };
	runInNewContext(`(function () { ${guard}\n allowed = true; })();`, context);
	return context.allowed;
}

for (const path of [
	"/plan",
	"/plan/",
	"/plan?sport=e_touringbicycle",
	"/plan/@61.4837045,23.7608430,8.673z?sport=e_touringbicycle",
	"/tour/3287158188/zoom",
	"/tour/123/edit?sport=mtb",
]) {
	test(`manifest and both scripts accept ${path}`, function () {
		const url = new URL(path, "https://www.komoot.com");
		assert.ok(matches.some((pattern) => pattern.test(url.href)));
		for (const file of ["content.js", "sidebar.js"])
			assert.equal(scriptAllows(file, url.pathname), true);
	});
}

for (const path of ["/", "/planner", "/plans", "/tour/123", "/tour/123/photos", "/profile/plan"]) {
	test(`unrelated page ${path} stays excluded`, function () {
		assert.equal(
			matches.some((pattern) => pattern.test(`https://www.komoot.com${path}`)),
			false,
		);
		for (const file of ["content.js", "sidebar.js"]) assert.equal(scriptAllows(file, path), false);
	});
}
