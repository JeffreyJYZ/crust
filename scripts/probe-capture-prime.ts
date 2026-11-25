#!/usr/bin/env bun
/**
 * One `window.capture` prime measurement per launch, in the technique named on the command line:
 *
 *     bun run scripts/probe-capture-prime.ts order-back
 *
 * Attempts, in the order the brief measures them: `baseline` (never composited, no technique),
 * `order-back`, `alpha-low`, `tiny-alpha-zero`, `public-paint`. The window starts at -4000,-4000 so
 * WebKit never composites it; each attempt asks one question about waking that view. One launch per
 * attempt, because a second capture supersedes the first and a window state cannot be undone without
 * leaving the last measurement behind.
 *
 * Nothing activates, no cursor moves and no Space changes. Attempts 1-3 briefly place a small probe
 * window on a display; they report exactly what was visible and restore frame, alpha and ordering in
 * a finally. Each prints ONE JSON line: facts, the composite step's time, the decoded picture and the
 * restored state.
 */
import { shim } from "@/platform/darwin/index.ts";
import { cls, cstr, S } from "@/platform/darwin/objc.ts";
import { DarwinPlatform } from "@/platform/darwin/platform.ts";
import { takeSnapshot } from "@/platform/darwin/snapshot.ts";
import { guardFocus, restoreFocus } from "./e2e-harness.ts";
import { decodePng } from "./probe-capture-png.ts";

const ATTEMPTS = [
	"baseline",
	"order-back",
	"alpha-low",
	"tiny-alpha-zero",
	"public-paint",
	"front-opaque",
	"force-visible",
];
const OFF = { x: -4000, y: -4000, w: 480, h: 320 };
const CORNER = { x: 20, y: 20, w: 40, h: 30 };

const PAGE = `<!doctype html><meta charset="utf-8"><title>prime probe</title>
<style>html,body{margin:0;height:100%;overflow:hidden}i{display:block;height:25%}</style>
<i style="background:#e11d48"></i><i style="background:#2563eb"></i>
<i style="background:#16a34a"></i><i style="background:#f59e0b"></i>
<script>fetch("/ready")</script>`;

/** The geometry, visibility and ownership facts the attempt starts from. */
function facts(win: number, app: number, sh: ReturnType<typeof shim>): Record<string, number> {
	const frame = [0, 1, 2, 3].map((i) =>
		Number(sh.symbols.shim_window_frame_num(win, i) ?? NaN),
	);
	return {
		x: frame[0] ?? -1,
		y: frame[1] ?? -1,
		w: frame[2] ?? -1,
		h: frame[3] ?? -1,
		alpha: Number(sh.symbols.shim_window_opacity(win) ?? -1),
		visible: Number(sh.symbols.shim_window_is_visible(win) ?? -1),
		onActiveSpace: Number(sh.symbols.shim_window_is_on_active_space(win) ?? -1),
		isKey: Number(sh.symbols.shim_window_is_key(win) ?? -1),
		occlusionState: S.q0(win, "occlusionState"),
		appHidden: S.b0(app, "isHidden") ? 1 : 0,
	};
}

/** Place the window at `at`, optionally transparent, in Z order `back` or front. */
function place(win: number, at: typeof CORNER, alpha: number, back: boolean, sh: ReturnType<typeof shim>): void {
	sh.symbols.shim_window_set_frame(win, at.x, at.y, at.w, at.h);
	sh.symbols.shim_window_set_opacity(win, alpha);
	if (back) S.v1(win, "orderBack:", 0);
	else S.v0(win, "orderFrontRegardless");
}

async function main(): Promise<void> {
	const attempt = process.argv[2] ?? "";
	if (!ATTEMPTS.includes(attempt)) {
		console.log(JSON.stringify({ unreachable: `unknown attempt ${JSON.stringify(attempt)}` }));
		process.exit(2);
	}
	if (process.platform !== "darwin") {
		console.log(JSON.stringify({ unreachable: `no WKWebView on ${process.platform}` }));
		process.exit(0);
	}

	const frontmost = guardFocus();
	const platform = new DarwinPlatform({ appName: "crust-prime-probe", activate: "never" });
	await platform.start();
	const app = S.p0(cls("NSApplication"), "sharedApplication", true);
	S.vq1(app, "setActivationPolicy:", 1);
	const sh = shim();
	const configuration = Number(sh.symbols.shim_webview_configuration() ?? 0);
	const web = Number(sh.symbols.shim_webview_new(configuration, OFF.w, OFF.h) ?? 0);
	const win = Number(sh.symbols.shim_window_new(OFF.x, OFF.y, OFF.w, OFF.h, 0n, 2n, 0) ?? 0);
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
	let compositeMs = -1;
	let onScreenDuring = "none";
	let error = "";
	let width = 0;
	let height = 0;
	let opaque = 0;
	let colours = 0;
	let captureMs = -1;
	let before: Record<string, number> = {};
	let during: Record<string, number> = {};
	let restored: Record<string, number> = {};
	try {
		S.v1(win, "setContentView:", web);
		S.v0(win, "orderFrontRegardless");
		sh.symbols.shim_webview_load(web, cstr(`http://127.0.0.1:${server.port}/`));
		platform.pump(16);
		const loaded = Date.now() + 4000;
		while (!ready && Date.now() < loaded) await Bun.sleep(20);
		// The real caller armed its capture 2500 ms after boot, with the view already suspended.
		await Bun.sleep(3000);
		before = facts(win, app, sh);
		if (attempt !== "baseline") {
			const started = Date.now();
			if (attempt === "order-back") {
				place(win, CORNER, 1, true, sh);
				onScreenDuring = `${CORNER.w}x${CORNER.h} at (${CORNER.x},${CORNER.y}), ordered back`;
			} else if (attempt === "alpha-low") {
				place(win, CORNER, 0.01, false, sh);
				onScreenDuring = `${CORNER.w}x${CORNER.h} at (${CORNER.x},${CORNER.y}), alpha 0.01`;
			} else if (attempt === "tiny-alpha-zero") {
				place(win, { x: CORNER.x, y: CORNER.y, w: 1, h: 1 }, 0, false, sh);
				onScreenDuring = `1x1 at (${CORNER.x},${CORNER.y}), alpha 0`;
			} else if (attempt === "public-paint") {
				S.v0(win, "display");
				S.v0(web, "displayIfNeeded");
				onScreenDuring = "none: -[NSWindow display] and -[NSView displayIfNeeded] only";
			} else if (attempt === "front-opaque") {
				place(win, { x: 20, y: 20, w: 120, h: 90 }, 1, false, sh);
				onScreenDuring = "120x90 at (20,20), alpha 1, front (positive control)";
			} else if (attempt === "force-visible") {
				// Private, harness-only: forces AppKit's composited bit without ordering the window.
				S.vb1(win, "_setOcclusionStateIsVisible:", 1);
				onScreenDuring = "none: -[NSWindow _setOcclusionStateIsVisible:1] only";
			}
			for (let i = 0; i < 8; i++) platform.pump(16);
			await Bun.sleep(250);
			compositeMs = Date.now() - started;
			during = facts(win, app, sh);
		}
		const captureStart = Date.now();
		try {
			const shot = await takeSnapshot(web, undefined, 2500);
			captureMs = Date.now() - captureStart;
			const measured = decodePng(Buffer.from(shot.png, "base64"));
			width = measured.width;
			height = measured.height;
			opaque = measured.opaque;
			colours = measured.colours;
		} catch (thrown) {
			captureMs = Date.now() - captureStart;
			error = thrown instanceof Error ? thrown.message : String(thrown);
		}
	} finally {
		if (attempt !== "baseline") {
			sh.symbols.shim_window_set_frame(win, OFF.x, OFF.y, OFF.w, OFF.h);
			sh.symbols.shim_window_set_opacity(win, 1);
			S.v0(win, "orderFrontRegardless");
			for (let i = 0; i < 4; i++) platform.pump(16);
			restored = facts(win, app, sh);
		}
		if (win) S.v0(win, "close");
		server.stop(true);
		platform.stopPump();
		await restoreFocus(frontmost);
	}
	console.log(
		JSON.stringify({ attempt, ready, before, during, compositeMs, onScreenDuring, captureMs, width, height, opaque, colours, error, restored }),
	);
	process.exit(0);
}

main().catch((thrown: unknown) => {
	console.log(JSON.stringify({ error: thrown instanceof Error ? thrown.message : String(thrown) }));
	process.exit(1);
});
