/**
 * What makes `-evaluateJavaScript:` prompt in a window nobody can see.
 *
 * Measured 2026-11-25 on this macOS. Run with `probe-run bun scripts/probe-eval-visibility.ts`.
 * Read each row as: `occ` = NSWindow.occlusionState (bit 2 means composited); `settle` = send to
 * completion in ms; `stalls` = evaluations past `EVAL_CAP_MS` out of `EVALS`; `ran` = when the page's
 * own fetch from inside the eval script reached the harness; `beats` and `page` = whether the page
 * kept running and at what clock rate. `-1` means the event never arrived inside the cap.
 *
 * Results that moved the fix:
 * - Offscreen -4000,-4000, alpha 1 or 0, ordered front, CanJoinAllSpaces (1): 0/6 stalls, 17 ms.
 *   Being off the active Space is not fatal by itself, and alpha is not the lever: the offscreen
 *   alpha-1 control was equally prompt.
 * - On-screen, alpha 0, same ordering, with the private occlusion selector the live test applies:
 *   6/6 stalls (5/6 on repeat). Page heartbeat and page clock advanced throughout (279 beats in
 *   23.9 s wall, 23.92 s of page clock), WebContent `ps` state Ss and never T. The first script ran
 *   1 ms after send but its completion never settled, so the delay is in the reply, not page work.
 * - Same on-screen alpha-0 arrangement with private `-[NSWindow _setOcclusionStateIsVisible:1]`
 *   (occ 8192 -> 8194): 0/6 stalls, 17 ms. The composited bit, not alpha or Space membership, is
 *   what WebKit uses to schedule the reply. That selector is private: harness only, never product.
 *
 * This probe says nothing about a fullscreen app owning the active Space. CanJoinAllSpaces does not
 * put a normal window into a fullscreen Space — the runtime has separate private
 * `_canJoinActiveFullScreenSpace` and `_joinActiveFullScreenSpaceUsingPosition:` — so reaching that
 * state needs a fullscreen app on a dedicated display or VM, under probe-run. Do not read these rows
 * as an answer to the capture defect.
 *
 * Nothing is activated and nothing is shown: windows are alpha 0 or off every display, and the app
 * runs with `activate: "never"`.
 */
import { cstr, S } from "../src/platform/darwin/objc.ts";
import { captureFrontmost, restoreFocus } from "./harness/focus.ts";

import { PAGE, VARIANTS, type Variant } from "./probe-eval-visibility-fixture.ts";

/** Short enough that a stalled state reports in seconds; long enough that a prompt eval never hits it. */
const EVAL_CAP_MS = 4000;
const EVALS = 6;

interface Beat {
	page: number;
	wall: number;
	visibility: string;
}

const beats: Beat[] = [];
let ranAt = 0;

const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: (req) => {
		const u = new URL(req.url);
		if (u.pathname === "/beat") {
			beats.push({
				page: Number(u.searchParams.get("t") ?? 0),
				wall: performance.now(),
				visibility: u.searchParams.get("v") ?? "?",
			});
			return new Response("ok");
		}
		if (u.pathname === "/ran") {
			ranAt = performance.now();
			return new Response("ok");
		}
		return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
	},
});

const deadline = (ms: number): Promise<"timeout"> =>
	new Promise((done) => setTimeout(() => done("timeout"), ms));

/** One evaluation: when it was sent, when the page ran it, and how long the completion took. */
async function timeOne(
	evaluate: (script: string) => Promise<string>,
	id: number,
): Promise<{ settle: number; ran: number }> {
	ranAt = 0;
	const sent = performance.now();
	const script = `fetch('/ran?id=${id}&t=' + performance.now()); "ok"`;
	const answer = await Promise.race([
		evaluate(script).then(() => performance.now() - sent),
		deadline(EVAL_CAP_MS),
	]);
	return {
		settle: answer === "timeout" ? -1 : Math.round(answer),
		ran: ranAt ? Math.round(ranAt - sent) : -1,
	};
}

/** `ps` state of a pid: `T` would mean a stopped process, which is the suspended-page answer. */
async function processState(pid: number): Promise<string> {
	if (pid <= 0) return "no-pid";
	const child = Bun.spawn(["ps", "-o", "stat=", "-p", String(pid)], {
		stdout: "pipe",
		stderr: "ignore",
	});
	const text = await new Response(child.stdout).text();
	await child.exited;
	return text.trim() === "" ? "gone" : text.trim();
}

const row = async (variant: Variant): Promise<void> => {
	const { shim } = await import("../src/platform/darwin/index.ts");
	const { DarwinPlatform } = await import("../src/platform/darwin/platform.ts");
	const { darwinTestingAdapter, setTestingTimeoutFrames } =
		await import("../src/plugins/testing-darwin.ts");
	const { perfNative } = await import("../src/cli/perf/perf-native.ts");
	const platform = new DarwinPlatform({ appName: "crust-eval-probe", activate: "never" });
	const native = perfNative();
	let win = 0;
	try {
		await platform.start();
		platform.pump(16);
		const configuration = Number(shim().symbols.shim_webview_configuration() ?? 0);
		const web = Number(shim().symbols.shim_webview_new(configuration, 480, 320) ?? 0);
		win = Number(
			shim().symbols.shim_window_new(variant.x, variant.y, 480, 320, 0n, 2n, 0) ?? 0,
		);
		S.v1(win, "setContentView:", web);
		S.vb1(win, "setIgnoresMouseEvents:", 1);
		S.pd1(win, "setAlphaValue:", variant.alpha);
		native.perf_keep_awake();
		if (variant.occlusion) native.perf_occlusion(web, 0);
		if (variant.ordered) {
			S.vq1(win, "setCollectionBehavior:", 1);
			S.v0(win, "orderFrontRegardless");
			if (variant.occlusion) native.perf_occlusion(web, 0);
		}
		if (variant.forceVisible) S.vb1(win, "_setOcclusionStateIsVisible:", 1);
		beats.length = 0;
		setTestingTimeoutFrames(() => -1);
		const url = `http://127.0.0.1:${server.port}/`;
		shim().symbols.shim_webview_load(web, cstr(url));
		const up = performance.now() + 5000;
		while (beats.length === 0 && performance.now() < up) await Bun.sleep(20);
		if (beats.length === 0) throw new Error("page never loaded");
		const pid = S.q0(web, "_webProcessIdentifier");
		await Bun.sleep(500);
		const from = beats.length;
		const adapter = darwinTestingAdapter(() => web);
		const evaluate = async (script: string): Promise<string> =>
			String(await adapter.evaluate(undefined, script));
		const runs: Array<{ settle: number; ran: number }> = [];
		for (let i = 0; i < EVALS; i++) runs.push(await timeOne(evaluate, i));
		const during = beats.slice(from);
		const span = during.length > 1 ? during.at(-1)!.wall - during[0]!.wall : 0;
		const gap = during.length > 1 ? (during.at(-1)!.page - during[0]!.page) / 1000 : 0;
		const rate = span > 0 ? (during.length / (span / 1000)).toFixed(1) : "?";
		const settles = runs.map((r) => r.settle).sort((a, b) => a - b);
		console.log(
			`${variant.name} | occ=${S.q0(win, "occlusionState")} activeSpace=${S.b0(win, "isOnActiveSpace")} ` +
				`vis=${during.at(-1)?.visibility ?? "?"} state=${await processState(pid)} | ` +
				`beats=${during.length} in ${Math.round(span)}ms (${rate}/s, page ${gap.toFixed(2)}s) | ` +
				`settle med=${settles[2]} max=${settles.at(-1)} stalls=${settles.filter((s) => s < 0).length}/${EVALS} | ` +
				`ran=${runs.map((r) => r.ran).join(",")}`,
		);
	} finally {
		if (win) S.v0(win, "close");
		platform.stopPump();
	}
};

const before = await captureFrontmost();
try {
	for (const variant of VARIANTS) {
		try {
			await row(variant);
		} catch (error) {
			console.log(`${variant.name} FAILED ${(error as Error).message}`);
		}
	}
} finally {
	server.stop(true);
	await restoreFocus(before);
}
