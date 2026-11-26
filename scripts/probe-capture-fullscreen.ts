#!/usr/bin/env bun
/**
 * The reported capture condition as a command the owner can type:
 *
 *     bun run scripts/probe-capture-fullscreen.ts
 *     bun run scripts/probe-capture-fullscreen.ts --wait 15   # press ⌃⌘F while it waits
 *
 * One process, a screenful of lines at most. The predicate is a platform fact on the probe's own
 * window: NSWindowOcclusionState's composited bit (8192 = never composited, 8194 = composited).
 * Frontmost app, fullscreen windows, Space membership and visibility are printed as context only.
 * Off the active Space was a coincidence of the launching arrangement, not the cause.
 *
 * Three captures on that window, in order: bare, `ignoreOcclusion: true` (not enough on its own),
 * and `prime: true` (the fix). PASS needs a named refusal from an un-primed capture AND real pixels
 * from prime; a flat `ok` from an un-primed capture is the #106 regression, not a pass.
 *
 * `--composited` is harness-only: it forces the bit so the refusal test has a composited window.
 * No activation, no window movement, no cursor, no other app's Space. `activate: "never"` and the
 * accessory policy keep the process off screen and out of the Dock, and no exit focus guard is armed
 * because `restoreFocus` would activate an app. `captureFrontmost()` is the read-only half of the
 * focus helpers; this probe never becomes the app it reads.
 */
import { perfNative } from "@/cli/perf/perf-native.ts";
import { shim } from "@/platform/darwin/index.ts";
import { cls, cstr, S } from "@/platform/darwin/objc.ts";
import { DarwinPlatform } from "@/platform/darwin/platform.ts";
import { capture, type Shot } from "./capture-fullscreen/shot.ts";
import { APP, printState, readState } from "./capture-fullscreen/state.ts";
import { parseWait, USAGE, waitForCondition } from "./capture-fullscreen/wait.ts";

/** Four opaque bands, so distinct colours prove a render rather than a uniform fill. */
const PAGE = `<!doctype html><meta charset="utf-8"><title>fullscreen capture probe</title>
<style>html,body{margin:0;height:100%;overflow:hidden}i{display:block;height:25%}</style>
<i style="background:#e11d48"></i><i style="background:#2563eb"></i>
<i style="background:#16a34a"></i><i style="background:#f59e0b"></i>`;

/** A named failure from the snapshot, never a bare "ok" with bytes. */
const REFUSALS = new Set(["no-completion", "no-picture"]);

/** Real pixels: more than one colour and a non-zero differing count, not just a PNG. */
function realPixels(shot: Shot): boolean {
	const m = shot.measured;
	return (
		shot.answer === "ok" &&
		shot.picture === "real" &&
		(m?.colours ?? 0) > 1 &&
		(m?.differing ?? 0) > 0
	);
}

/** WebKit answered with a picture of one flat colour: the state #106 names `no-picture`. */
function flatOk(shot: Shot): boolean {
	return shot.answer === "ok" && shot.picture === "blank";
}

/** One line per capture: elapsed, answer, and every number the decoded PNG gives. */
function describe(label: string, shot: Shot): string {
	const m = shot.measured;
	return (
		`capture ${label}: ${shot.ms}ms ${shot.answer} ${shot.picture} ` +
		`width=${m?.width ?? 0} height=${m?.height ?? 0} scale=${shot.scale} bytes=${shot.bytes} ` +
		`pixels=${m?.pixels ?? 0} opaque=${m?.opaque ?? 0} ` +
		`colours=${m?.colours ?? 0} differing=${m?.differing ?? 0}`
	);
}

async function main(): Promise<number> {
	const args = parseWait(process.argv.slice(2));
	if (args.error) {
		console.error(`crust: ${args.error}`);
		console.error(USAGE);
		return 2;
	}

	if (process.platform !== "darwin") {
		console.log("frontmost: n/a (not macOS)");
		console.log("fullscreen: n/a");
		console.log("window: n/a");
		console.log("condition: NO (no window with a composited bit on this platform)");
		console.log("verdict: REFUSED (nothing measured)");
		return 2;
	}

	const platform = new DarwinPlatform({ appName: APP, activate: "never" });
	await platform.start();
	const app = S.p0(cls("NSApplication"), "sharedApplication", true);
	S.vq1(app, "setActivationPolicy:", 1);
	perfNative().perf_keep_awake();
	let win = 0;
	let server: ReturnType<typeof Bun.serve> | undefined;
	try {
		const configuration = Number(shim().symbols.shim_webview_configuration() ?? 0);
		const web = Number(shim().symbols.shim_webview_new(configuration, 480, 320) ?? 0);
		win = Number(shim().symbols.shim_window_new(-4000, -4000, 480, 320, 0n, 2n, 0) ?? 0);
		S.v1(win, "setContentView:", web);
		S.v0(win, "orderFrontRegardless");
		if (args.forceComposite) {
			// Private NSWindow SPI, harness only: sets the composited bit without moving or showing.
			S.vb1(win, "_setOcclusionStateIsVisible:", 1);
		}
		server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () =>
				new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }),
		});
		shim().symbols.shim_webview_load(web, cstr(`http://127.0.0.1:${server.port}/`));
		platform.pump(16);
		await Bun.sleep(500);

		// The window exists before any wait starts: the transition needs something to leave behind.
		let state = await readState(win);
		printState(state);
		if (args.seconds !== undefined) {
			console.log(
				`waiting up to ${args.seconds} s for the view to stop compositing — press ⌃⌘F in any app`,
			);
			const waited = await waitForCondition(async () => {
				state = await readState(win);
				return { ok: state.condition, reason: state.reason };
			}, args.seconds);
			console.log(
				`waited: ${(waited.waitedMs / 1000).toFixed(1)} s ` +
					(waited.ok ? `(condition met)` : `(timed out — ${waited.last.reason})`),
			);
			printState(state);
		}

		const bare = await capture(web);
		console.log(describe("bare", bare));
		const ignored = await capture(web, { ignoreOcclusion: true });
		console.log(describe("ignoreOcclusion=true", ignored));
		const primed = await capture(web, { prime: true });
		console.log(describe("prime=true", primed));

		if (!state.condition) {
			console.log(`verdict: REFUSED (condition absent: ${state.reason})`);
			return 2;
		}
		if (!realPixels(primed)) {
			console.log(
				`verdict: FAIL (prime produced no pixels: ` +
					`code=${primed.answer} message=${primed.message ?? primed.answer})`,
			);
			return 1;
		}
		if (flatOk(bare) || flatOk(ignored)) {
			console.log(
				"verdict: FAIL (an un-primed capture answered ok with a flat picture: #106 regression)",
			);
			return 1;
		}
		if (!REFUSALS.has(bare.answer) && !REFUSALS.has(ignored.answer)) {
			console.log(
				`verdict: REFUSED (nothing to measure: un-primed captures answered ok with real ` +
					`pixels, so the view composited despite occlusionState=${state.occlusion})`,
			);
			return 2;
		}
		console.log(
			"verdict: PASS (never composited, un-primed capture refused, prime produced real pixels)",
		);
		return 0;
	} finally {
		if (win) S.v0(win, "close");
		server?.stop(true);
		platform.stopPump();
	}
}

main()
	.then((code) => process.exit(code))
	.catch((error: unknown) => {
		const detail = error instanceof Error ? error.message : String(error);
		console.log(`condition: NO (unreachable: ${detail})`);
		console.log("verdict: REFUSED (nothing measured)");
		process.exit(2);
	});
