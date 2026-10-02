// Run against an installed desktop browser in a disposable profile, with no extension build.
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
const [browser, snapshot] = process.argv.slice(2);
const paths = { chrome: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", firefox: "/Applications/Firefox.app/Contents/MacOS/firefox", brave: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" };
if (!paths[browser] || !snapshot) throw new Error("Usage: node scripts/local-osm/benchmark.mjs chrome|firefox|brave /path/to/snapshot");
const root = fileURLToPath(new URL("../../", import.meta.url)), data = resolve(snapshot);
const manifest = JSON.parse(await readFile(join(data, "manifest.json"), "utf8"));
const allowed = new Set(manifest.shards.map((s) => s.file));
const profile = await mkdtemp(join(tmpdir(), "krb-osm-browser-"));
let child, peakProcessTreeRssBytes = 0, timer, timeout, finish;
const completed = new Promise(function (resolve) { finish = resolve; });
const server = createServer(async function (req, res) {
	try {
		if (req.url === "/result" && req.method === "POST") {
			let body = ""; for await (const chunk of req) body += chunk;
			const value = JSON.parse(body); res.end("ok");
			if (value.progress) console.error(`Validated ${value.progress.completed}/${value.progress.total} shards`);
			else finish(value);
			return;
		}
		if (req.url === "/") {
			res.setHeader("Content-Type", "text/html");
			res.end('<!doctype html><title>Local OSM benchmark</title><p>Running in a worker.</p><script>const w=new Worker("/benchmark-worker.js");w.onmessage=e=>fetch("/result",{method:"POST",body:JSON.stringify(e.data)});w.onerror=e=>fetch("/result",{method:"POST",body:JSON.stringify({error:e.message})});</script>'); return;
		}
		let path;
		if (req.url === "/manifest.json") path = join(data, "manifest.json");
		else if (req.url.startsWith("/data/") && allowed.has(req.url.slice(6))) path = join(data, req.url.slice(6));
		else if (["/local-osm.js", "/osm-cache.js", "/hazards.js", "/route-check.js"].includes(req.url)) path = join(root, req.url.slice(1));
		else if (req.url === "/benchmark-worker.js") path = join(root, "scripts/local-osm/benchmark-worker.js");
		else { res.writeHead(404); res.end(); return; }
		res.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : "application/octet-stream");
		const stream = createReadStream(path); stream.on("error", function (error) { res.destroy(error); }); stream.pipe(res);
	}
	catch (error) { res.writeHead(500); res.end(String(error)); }
});
await new Promise(function (resolve) { server.listen(0, "127.0.0.1", resolve); });
try {
	const url = `http://127.0.0.1:${server.address().port}/`;
	const args = browser === "firefox" ? ["--headless", "--no-remote", "--profile", profile, url] : ["--headless=new", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, url];
	child = spawn(paths[browser], args, { stdio: "ignore" });
	child.on("error", (error) => finish({ error: String(error) }));
	child.on("exit", (code) => finish({ error: `Browser exited before completion (${code})` }));
	timer = setInterval(function () {
		try {
			const rows = execFileSync("ps", ["-axo", "pid,ppid,rss"], { encoding: "utf8" }).trim().split("\n").slice(1).map((line) => line.trim().split(/\s+/).map(Number));
			const pids = new Set([child.pid]); let changed = true;
			while (changed) { changed = false; for (const [pid, parent] of rows) if (pids.has(parent) && !pids.has(pid)) { pids.add(pid); changed = true; } }
			peakProcessTreeRssBytes = Math.max(peakProcessTreeRssBytes, rows.reduce((sum, [pid, , rss]) => sum + (pids.has(pid) ? rss * 1024 : 0), 0));
		}
		catch (error) { console.error("RSS sample failed:", error.message); }
	}, 2000);
	timeout = setTimeout(() => finish({ error: "Benchmark exceeded 15 minutes" }), 15 * 60 * 1000);
	const outcome = await completed;
	console.log(JSON.stringify({ ...outcome, peakProcessTreeRssBytes }, null, 2));
	if (outcome.error) process.exitCode = 1;
}
finally {
	clearInterval(timer); clearTimeout(timeout);
	if (child && child.exitCode === null) {
		const exited = new Promise(function (resolve) { child.once("exit", resolve); }); child.kill("SIGTERM"); await exited;
	}
	server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
	await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
