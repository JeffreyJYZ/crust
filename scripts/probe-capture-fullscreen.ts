#!/usr/bin/env bun
/**
 * The reported fullscreen capture condition as a command the owner can type:
 *
 *     bun run scripts/probe-capture-fullscreen.ts
 *
 * One process, no arguments, at most eight short lines. It detects the condition instead of assuming
 * it: the frontmost app and its fullscreen windows come from read-only System Events, and the probe
 * window's Space and occlusion come from AppKit. `condition: YES` needs BOTH a fullscreen app owning
 * the active Space and this probe window off it. A normal desktop is a refusal, never a pass.
 *
 * Three captures on that same never-composited window, in order: bare, `ignoreOcclusion: true` (not
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
import { captureFrontmost } from "./e2e-harness.ts";

const APP = "crust-fullscreen-capture";
const FULLSCREEN = `tell application "System Events"
set found to {}
repeat with p in (every process whose background only is false)
try
repeat with w in (windows of p)
if (value of attribute "AXFullScreen" of w) is true then
set end of found to (name of p)
exit repeat
end if
end repeat
end try
end repeat
return found
end tell`;

/** Four opaque bands, so distinct colours prove a render rather than a uniform fill. */
const PAGE = `<!doctype html><meta charset="utf-8"><title>fullscreen capture probe</title>
<style>html,body{margin:0;height:100%;overflow:hidden}i{display:block;height:25%}</style>
<i style="background:#e11d48"></i><i style="background:#2563eb"></i>
<i style="background:#16a34a"></i><i style="background:#f59e0b"></i>`;

/** Read-only AppleScript; an empty answer is reported, never guessed at. */
function ask(source: string): string {
	try {
		const result = Bun.spawnSync(["osascript", "-e", source], {
			stdout: "pipe",
			stderr: "pipe",
		});
		return result.exitCode === 0 ? new TextDecoder().decode(result.stdout).trim() : "";
	} catch {
		return "";
	}
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
	const frontmost = (await captureFrontmost()) ?? "unknown";
	const listed = ask(FULLSCREEN);
	const fullscreen = listed
		? listed
				.split(",")
				.map((name) => name.trim())
				.filter(Boolean)
		: [];
	const other = fullscreen.filter((name) => name.toLowerCase() !== APP.toLowerCase());
	const fullscreenFrontmost = other.some(
		(name) => name.toLowerCase() === frontmost.toLowerCase(),
	);

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

		const onActiveSpace = S.b0(win, "isOnActiveSpace");
		const occlusion = S.q0(win, "occlusionState");
		const visible = S.b0(win, "isVisible");
		// A fullscreen app on another display keeps this window on the active Space, which is
		// visibly NOT the reported state. Both facts are required before the gate applies.
		const condition = fullscreenFrontmost && !onActiveSpace;
		const reason = !fullscreenFrontmost
			? `frontmost ${frontmost} has no fullscreen window`
			: onActiveSpace
				? `the probe window is on the active Space, so no fullscreen app owns it`
				: `frontmost ${frontmost} is fullscreen and the probe window is off its Space`;

		console.log(`frontmost: ${frontmost}`);
		console.log(`fullscreen: ${other.length ? other.join(", ") : "none"}`);
		console.log(
			`window: onActiveSpace=${onActiveSpace ? 1 : 0} occlusion=${occlusion} visible=${visible ? 1 : 0}`,
		);
		console.log(`condition: ${condition ? "YES" : "NO"} (${reason})`);

		const bare = await capture(web);
		console.log(describe("bare", bare));
		const ignored = await capture(web, { ignoreOcclusion: true });
		console.log(describe("ignoreOcclusion=true", ignored));
		const primed = await capture(web, { prime: true });
		console.log(describe("prime=true", primed));

		if (!condition) {
			console.log(`verdict: REFUSED (condition absent: ${reason})`);
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
