#!/usr/bin/env bun
/**
 * Hold-from-creation vs control, for both capture and eval, in one arrangement: a WKWebView in a
 * window at -4000,-4000 that has never been composited. The hold is an `occlusionOwner` slot acquired
 * BEFORE the page loads; the control acquires none. Both then idle 3000 ms with no capture or eval,
 * so the question is whether the view was kept alive from creation rather than woken afterwards.
 *
 *     bun run scripts/probe-capture-hold.ts hold-capture
 *
 * Modes: `hold-capture`, `control-capture`, `hold-eval`, `control-eval`. Nothing activates, moves a
 * window in its measured state, changes a Space or moves the cursor. One launch per mode, one JSON
 * line: facts, the hold sends, the elapsed time, and whether a real picture or a prompt eval arrived.
 */
import { shim } from "@/platform/darwin/index.ts";
import { cls, cstr, S } from "@/platform/darwin/objc.ts";
import { DarwinPlatform } from "@/platform/darwin/platform.ts";
import { occlusionOwner } from "@/platform/darwin/occlusion.ts";
import { darwinSnapshotShim, takeSnapshot } from "@/platform/darwin/snapshot.ts";
import { darwinTestingAdapter } from "@/plugins/testing-darwin.ts";
import { guardFocus, restoreFocus } from "./e2e-harness.ts";
import { decodePng } from "./probe-capture-png.ts";

const MODES = ["hold-capture", "control-capture", "hold-eval", "control-eval"];
const IDLE_MS = 3000;
const CAP_MS = 4000;
const PAGE = `<!doctype html><meta charset="utf-8"><title>hold probe</title>
<style>html,body{margin:0;height:100%;overflow:hidden}i{display:block;height:25%}</style>
<i style="background:#e11d48"></i><i style="background:#2563eb"></i>
<i style="background:#16a34a"></i><i style="background:#f59e0b"></i>
<script>fetch("/ready")</script>`;

/** A Promise.race cap so a stalled completion is reported in seconds, not a 30 s budget. */
const deadline = (ms: number): Promise<"timeout"> =>
	new Promise((done) => setTimeout(() => done("timeout"), ms));

async function main(): Promise<void> {
	const mode = process.argv[2] ?? "";
	if (!MODES.includes(mode)) {
		console.log(JSON.stringify({ unreachable: `unknown mode ${JSON.stringify(mode)}` }));
		process.exit(2);
	}
	if (process.platform !== "darwin") {
		console.log(JSON.stringify({ unreachable: `no WKWebView on ${process.platform}` }));
		process.exit(0);
	}
	const frontmost = guardFocus();
	const platform = new DarwinPlatform({ appName: "crust-hold-probe", activate: "never" });
	await platform.start();
	const app = S.p0(cls("NSApplication"), "sharedApplication", true);
	S.vq1(app, "setActivationPolicy:", 1);
	const sh = shim();
	const configuration = Number(sh.symbols.shim_webview_configuration() ?? 0);
	const web = Number(sh.symbols.shim_webview_new(configuration, 480, 320) ?? 0);
	const win = Number(sh.symbols.shim_window_new(-4000, -4000, 480, 320, 0n, 2n, 0) ?? 0);
	const holder = Symbol("probe hold from creation");
	const sends: string[] = [];
	let ready = false;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (request) => {
			if (new URL(request.url).pathname === "/ready") {
				ready = true;
				return new Response("ok");
			}
			return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
		},
	});
	let result = "";
	let ms = -1;
	let width = 0;
	let height = 0;
	let opaque = 0;
	let colours = 0;
	let error = "";
	try {
		if (mode.startsWith("hold-")) {
			// Acquired before the webview loads anything: WebKit never sees a live view go away.
			occlusionOwner.acquire(web, holder, (target, enabled) => {
				sends.push(enabled ? "on" : "off");
				return Boolean(darwinSnapshotShim().occlusion?.(target, enabled));
			});
		}
		S.v1(win, "setContentView:", web);
		S.v0(win, "orderFrontRegardless");
		sh.symbols.shim_webview_load(web, cstr(`http://127.0.0.1:${server.port}/`));
		platform.pump(16);
		const up = Date.now() + 4000;
		while (!ready && Date.now() < up) await Bun.sleep(20);
		await Bun.sleep(IDLE_MS);
		const facts = {
			ready: ready ? 1 : 0,
			onActiveSpace: Number(sh.symbols.shim_window_is_on_active_space(win) ?? -1),
			visible: Number(sh.symbols.shim_window_is_visible(win) ?? -1),
			appHidden: S.b0(app, "isHidden") ? 1 : 0,
			holds: occlusionOwner.holds(web),
			sends: sends.join(","),
		};
		const started = Date.now();
		if (mode.endsWith("capture")) {
			try {
				const shot = await Promise.race([
					takeSnapshot(web, undefined, CAP_MS),
					deadline(CAP_MS + 500).then(() => {
						throw new Error("outer cap: capture did not settle");
					}),
				]);
				ms = Date.now() - started;
				const measured = decodePng(Buffer.from(shot.png, "base64"));
				width = measured.width;
				height = measured.height;
				opaque = measured.opaque;
				colours = measured.colours;
				result = opaque > 0 && colours > 1 ? "real" : "blank";
			} catch (thrown) {
				ms = Date.now() - started;
				error = thrown instanceof Error ? thrown.message : String(thrown);
				result = "failed";
			}
		} else {
			const evaluate = darwinTestingAdapter(() => web).evaluate;
			try {
				const answer = await Promise.race([
					evaluate(undefined, "1+1").then(String),
					deadline(CAP_MS),
				]);
				ms = Date.now() - started;
				result = answer === "timeout" ? "stalled" : `settled:${answer}`;
				if (answer === "timeout") error = "no eval completion inside the cap";
			} catch (thrown) {
				ms = Date.now() - started;
				error = thrown instanceof Error ? thrown.message : String(thrown);
				result = "failed";
			}
		}
		console.log(
			JSON.stringify({ mode, facts, idleMs: IDLE_MS, ms, result, width, height, opaque, colours, error }),
		);
	} finally {
		if (mode.startsWith("hold-")) occlusionOwner.release(web, holder);
		if (win) S.v0(win, "close");
		server.stop(true);
		platform.stopPump();
		await restoreFocus(frontmost);
	}
	process.exit(0);
}

main().catch((thrown: unknown) => {
	console.log(JSON.stringify({ error: thrown instanceof Error ? thrown.message : String(thrown) }));
	process.exit(1);
});
