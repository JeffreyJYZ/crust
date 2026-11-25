#!/usr/bin/env bun
/**
 * One `window.capture` measurement per launch, in the window state named on the command line:
 *
 *     bun run scripts/probe-capture-window-state.ts offscreen
 *
 * States: `onscreen`, `offscreen`, `offscreen-space`, `offscreen-trick`, `orderedout`,
 * `orderedout-plain`, `hidden`, `orphan`. One launch per state, because a second capture supersedes
 * the first and a state change cannot be undone without leaving the last measurement behind.
 *
 * Nothing is activated and no cursor moves: the app is an accessory (no Dock tile, no menu-bar
 * takeover), the window is built from the shim directly, and `orderFrontRegardless` never activates.
 * `onscreen` and `orderedout-plain` put a borderless window at (80, 80) on the real desktop for the
 * length of one capture.
 *
 * It prints ONE JSON line: the window facts, the seam's error or the measured picture. The PNG is
 * decoded (`probe-capture-png.ts`), because an API that answers "ok" with a 1x1 or fully transparent
 * image has not produced a picture.
 */

import { perfNative } from "@/cli/perf/perf-native.ts";
import { shim } from "@/platform/darwin/index.ts";
import { cls, cstr, S } from "@/platform/darwin/objc.ts";
import { DarwinPlatform } from "@/platform/darwin/platform.ts";
import { takeSnapshot } from "@/platform/darwin/snapshot.ts";
import type { WindowSnapshot } from "@/plugins/window-types.ts";
import { decodePng, type Measured } from "./probe-capture-png.ts";

const STATES = [
	"onscreen",
	"offscreen",
	"offscreen-space",
	"offscreen-trick",
	"orderedout",
	"orderedout-plain",
	"hidden",
	"orphan",
];

/** Four opaque bands, so a decoded picture proves a render rather than a uniform fill. */
const PAGE = `<!doctype html><meta charset="utf-8"><title>capture probe</title>
<style>html,body{margin:0;height:100%;overflow:hidden}i{display:block;height:25%}</style>
<i style="background:#e11d48"></i><i style="background:#2563eb"></i>
<i style="background:#16a34a"></i><i style="background:#f59e0b"></i>
<script>requestAnimationFrame(() => requestAnimationFrame(() => fetch("/ready")))</script>`;

async function main(): Promise<void> {
	const state = process.argv[2] ?? "";
	if (!STATES.includes(state)) {
		console.log(JSON.stringify({ unreachable: `unknown state ${JSON.stringify(state)}` }));
		process.exit(2);
	}
	if (process.platform !== "darwin") {
		console.log(JSON.stringify({ unreachable: `no WKWebView on ${process.platform}` }));
		process.exit(0);
	}

	const platform = new DarwinPlatform({ appName: "crust-capture-probe", activate: "never" });
	await platform.start();
	const app = S.p0(cls("NSApplication"), "sharedApplication", true);
	// Accessory: no Dock tile and no menu-bar takeover, so a two-second probe is not visible there.
	S.vq1(app, "setActivationPolicy:", 1);
	if (Number(shim().symbols.shim_on_main_runloop() ?? 0) !== 1) {
		console.log(JSON.stringify({ unreachable: "this thread does not own the main run loop" }));
		process.exit(0);
	}
	const native = perfNative();
	native.perf_keep_awake();

	const configuration = Number(shim().symbols.shim_webview_configuration() ?? 0);
	const web = Number(shim().symbols.shim_webview_new(configuration, 480, 320) ?? 0);
	const trick = state === "offscreen-trick" || state === "orderedout" || state === "hidden";
	// The two levers the existing live proof applies, separated so the table says which one moves
	// WebKit: collectionBehaviour alone, then that plus the private occlusion selector.
	const space = trick || state === "offscreen-space";
	const quiet = trick;
	const at =
		state === "onscreen" || state === "orderedout-plain"
			? { x: 80, y: 80 }
			: { x: -4000, y: -4000 };
	let win = 0;
	if (state !== "orphan") {
		win = Number(shim().symbols.shim_window_new(at.x, at.y, 480, 320, 0n, 2n, 0) ?? 0);
		S.v1(win, "setContentView:", web);
		if (quiet) native.perf_occlusion(web, 0);
		if (space) S.vq1(win, "setCollectionBehavior:", 1);
		S.v0(win, "orderFrontRegardless");
		if (quiet) native.perf_occlusion(web, 0);
	}

	let ready = false;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (request) => {
			const url = new URL(request.url);
			if (url.pathname === "/ready") {
				ready = true;
				return new Response("ok");
			}
			return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
		},
	});
	const loaded = Number(
		shim().symbols.shim_webview_load(web, cstr(`http://127.0.0.1:${server.port}/`)) ?? 0,
	);
	platform.pump(16);
	const deadline = Date.now() + 4000;
	while (!ready && Date.now() < deadline) await Bun.sleep(20);
	await Bun.sleep(250);
	if (state === "orderedout" || state === "orderedout-plain") S.v1(win, "orderOut:", 0);
	if (state === "hidden") S.v1(app, "hide:", 0);
	if (
		state !== "offscreen" &&
		state !== "offscreen-space" &&
		state !== "onscreen" &&
		state !== "orphan"
	)
		await Bun.sleep(250);

	const facts = {
		loaded,
		pageReady: ready,
		visible: win ? Number(shim().symbols.shim_window_is_visible(win) ?? -1) : -1,
		onActiveSpace: win ? Number(shim().symbols.shim_window_is_on_active_space(win) ?? -1) : -1,
		occlusionState: win ? Number(native.perf_occlusion_state(win)) : -1,
		appHidden: S.b0(app, "isHidden"),
		collectionBehaviour: space,
		occlusionDetectionDisabled: quiet,
	};

	const started = Date.now();
	let shot: WindowSnapshot | undefined;
	let error = "";
	try {
		shot = await takeSnapshot(web);
	} catch (thrown) {
		error = thrown instanceof Error ? thrown.message : String(thrown);
	}
	const ms = Date.now() - started;
	let measured: Measured | undefined;
	let decodeError = "";
	if (shot) {
		try {
			measured = decodePng(Buffer.from(shot.png, "base64"));
		} catch (thrown) {
			decodeError = thrown instanceof Error ? thrown.message : String(thrown);
		}
	}
	console.log(
		JSON.stringify({
			state,
			facts,
			ms,
			error,
			width: shot?.width ?? 0,
			height: shot?.height ?? 0,
			scale: shot?.scale ?? 0,
			bytes: shot ? Buffer.from(shot.png, "base64").length : 0,
			measured,
			decodeError,
		}),
	);

	if (win) S.v0(win, "close");
	if (facts.appHidden) S.v1(app, "unhide:", 0);
	platform.stopPump();
	server.stop(true);
	process.exit(0);
}

main().catch((error: unknown) => {
	console.log(
		JSON.stringify({
			unreachable: `probe threw: ${error instanceof Error ? error.message : String(error)}`,
		}),
	);
	process.exit(1);
});
