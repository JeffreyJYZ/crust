#!/usr/bin/env bun
/**
 * The fullscreen capture measurement, in ONE launch and with no arguments. It is the instrument for
 * the reported defect, not the fix: a real fullscreen app owning the active Space is detected, never
 * simulated, and an offscreen window that has never composited is captured twice.
 *
 * No activation, no window movement, no cursor. The app is an accessory built from the shim, the
 * window is ordered front only at -4000,-4000, and no exit focus guard is armed — that would
 * activate an app and steal the screen. Frontmost and fullscreen apps are READ with read-only System
 * Events; this probe never becomes either. Run it yourself while a fullscreen app owns the Space.
 *
 * Seven short lines: frontmost, fullscreen, window facts, condition, two captures, verdict. The gate
 * fails only when the condition was actually present and `ignoreOcclusion` yielded no real pixels;
 * on a normal desktop it says NOT-REPORTED-STATE and exits 0, never claiming a pass it did not see.
 */
import { perfNative } from "@/cli/perf/perf-native.ts";
import { shim } from "@/platform/darwin/index.ts";
import { cls, cstr, S } from "@/platform/darwin/objc.ts";
import { DarwinPlatform } from "@/platform/darwin/platform.ts";
import { capture, line } from "./capture-fullscreen/shot.ts";

const APP = "crust-fullscreen-capture";
const FRONTMOST =
	'tell application "System Events" to get name of first process whose frontmost is true';
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

async function main(): Promise<number> {
	const frontmost = ask(FRONTMOST) || "unknown";
	const listed = ask(FULLSCREEN);
	const fullscreen = listed
		? listed
				.split(",")
				.map((name) => name.trim())
				.filter(Boolean)
		: [];
	const other = fullscreen.filter((name) => name.toLowerCase() !== APP.toLowerCase());

	if (process.platform !== "darwin") {
		console.log("frontmost: n/a (not macOS)");
		console.log("fullscreen: n/a");
		console.log("window: n/a");
		console.log("condition: NO (no WKWebView on this platform)");
		console.log("verdict: NOT-REPORTED-STATE");
		return 0;
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
		// The reported state needs BOTH facts: a fullscreen app frontmost AND this probe window
		// pushed off the active Space. A fullscreen app on another display keeps onActiveSpace=1,
		// which is visibly not the state the gate exists to measure.
		const fullscreenFrontmost = other.some(
			(name) => name.toLowerCase() === frontmost.toLowerCase(),
		);
		const condition = fullscreenFrontmost && !onActiveSpace;

		console.log(`frontmost: ${frontmost}`);
		console.log(`fullscreen: ${other.length ? other.join(", ") : "none"}`);
		console.log(
			`window: onActiveSpace=${onActiveSpace ? 1 : 0} occlusion=${occlusion} visible=${visible ? 1 : 0}`,
		);
		console.log(
			`condition: ${condition ? "YES" : "NO"} (frontmost ${frontmost} ` +
				`fullscreen=${fullscreenFrontmost ? "yes" : "no"}, probe window ` +
				`${onActiveSpace ? "on" : "off"} the active Space)`,
		);

		const baseline = await capture(web, false);
		const fixed = await capture(web, true);
		console.log(line("ignoreOcclusion=false", baseline));
		console.log(line("ignoreOcclusion=true", fixed));

		if (!condition) {
			console.log("verdict: NOT-REPORTED-STATE (gate not applicable)");
			return 0;
		}
		if (fixed.picture !== "real") {
			console.log(
				"verdict: FAIL (fullscreen present, ignoreOcclusion produced no real pixels)",
			);
			return 1;
		}
		console.log("verdict: PASS (fullscreen present, ignoreOcclusion produced real pixels)");
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
		console.log(`unreachable: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	});
