#!/usr/bin/env bun
/**
 * The reported fullscreen capture condition as a command the owner can type:
 *
 *     bun run scripts/probe-capture-fullscreen.ts
 *     bun run scripts/probe-capture-fullscreen.ts --wait 15   # press ⌃⌘F while it waits
 *
 * One process, a screenful of lines at most. It detects the condition instead of assuming it: the
 * frontmost app and its fullscreen windows come from read-only System Events, and the probe window's
 * Space and occlusion come from AppKit. `condition: YES` needs BOTH a fullscreen app owning the
 * active Space and this probe window off it. A normal desktop is a refusal, never a pass.
 *
 * The condition is a transition: an accessory window joins the Space active when it is created, so
 * a probe started inside a fullscreen Space lands there and can never see the reported state.
 * `--wait` creates the window first, prints its state, then waits for another app to go fullscreen.
 *
 * Three captures on that never-composited window, in order: bare, `ignoreOcclusion: true` (not
 * enough on its own), and `prime: true` (the fix). Only the prime capture decides the verdict.
 *
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
		console.log("condition: NO (no WKWebView on this platform)");
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
				`waiting up to ${args.seconds} s for another app to go fullscreen — press ⌃⌘F in any app`,
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
		if (primed.picture !== "real") {
			console.log(
				`verdict: FAIL (fullscreen present, prime produced no real pixels: ` +
					`code=${primed.answer} message=${primed.message ?? primed.answer})`,
			);
			return 1;
		}
		console.log("verdict: PASS (fullscreen present, prime produced real pixels)");
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
