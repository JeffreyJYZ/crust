#!/usr/bin/env bun
/**
 * The focus-control probe, run on a real Mac.
 *
 * It does what the feature promises, in the only order that can prove it: capture the frontmost app,
 * build a window with `activate: false` under a running `NSApplication`, drive that page through
 * `testing`, render it through `window.capture`, then read the frontmost app back — all while the
 * human stays in whatever app they were using. Run it through `probe-run` so focus is handed back
 * even if this script dies:
 *
 *     probe-run bun scripts/probe-focus-control.ts
 *
 * A silent window is the point: no cursor moves, no Accessibility grant is asked for, and the
 * window is 480x320 in the corner. Every assertion is printed as a line, and the exit code is the
 * verdict — 0 only when the page was driven and the frontmost app never changed.
 */
import { captureFrontmost, guardFocus, restoreFocus } from "./e2e-harness.ts";

const PAGE = `<!doctype html>
<html><body style="margin:0;font:14px system-ui;background:#101216;color:#e8eaed">
<button id="go" style="margin:16px;padding:8px 16px">go</button>
<input id="name" style="margin:16px;padding:6px" />
<div id="out" style="margin:16px">idle</div>
<script>
	document.getElementById("go").onclick = function () {
		document.getElementById("out").textContent = "clicked";
	};
</script>
</body></html>`;

const APP = "crust-probe-focus";
const LABEL = "main";

interface Verdict {
	lines: string[];
	failures: string[];
}

/** Report one checked fact as a line, and count it as a failure when it is false. */
function check(verdict: Verdict, ok: boolean, label: string, detail: string): void {
	verdict.lines.push(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(22)} ${detail}`);
	if (!ok) verdict.failures.push(label);
}

async function probe(): Promise<Verdict> {
	const verdict: Verdict = { lines: [], failures: [] };
	if (process.platform !== "darwin") {
		verdict.lines.push("  skipped: this probe needs darwin");
		return verdict;
	}
	const { DarwinPlatform } = await import("../src/platform/darwin/platform.ts");
	const { createTestingPlugin } = await import("../src/plugins/testing.ts");
	const { darwinTestingAdapter } = await import("../src/plugins/testing-darwin.ts");
	const { windowCaptureAdapter } =
		await import("../src/platform/darwin/window-capture-adapter.ts");

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () =>
			new Response(PAGE, {
				headers: { "content-type": "text/html; charset=utf-8" },
			}),
	});
	// `always` on purpose: the per-window `activate: false` is what must win here, not the config.
	const platform = new DarwinPlatform({ appName: APP, activate: "always" });
	let open = false;
	try {
		await platform.start();
		platform.pump(16);
		platform.createWindow({
			label: LABEL,
			url: `http://127.0.0.1:${server.port}/`,
			width: 480,
			height: 320,
			title: "focus probe",
			activate: false,
		});
		open = true;

		const view = (label: string | undefined): number => {
			if (label !== undefined && label !== LABEL) throw new Error(`no window ${label}`);
			const web = platform.webview(LABEL);
			if (web === undefined) throw new Error(`no webview for ${LABEL}`);
			return web;
		};
		const testing = createTestingPlugin(darwinTestingAdapter(view));
		const capture = windowCaptureAdapter((label) => view(label));

		const ready = await testing.commands.waitFor({
			selector: "#go",
			timeoutMs: 8000,
		});
		check(verdict, "found" in ready && ready.found === true, "page loaded", "#go found");

		const typed = await testing.commands.type({
			selector: "#name",
			text: "hello",
		});
		check(verdict, "value" in typed && typed.value === "hello", "type", "value read back");

		await testing.commands.click({ selector: "#go" });
		const out = await testing.commands.query({ selector: "#out" });
		check(
			verdict,
			"text" in out && out.text === "clicked",
			"click",
			`#out text ${"text" in out ? JSON.stringify(out.text) : "?"}`,
		);

		const shot = await capture.capture?.(LABEL);
		check(
			verdict,
			shot !== undefined && shot.png.length > 0 && shot.width > 0,
			"window.capture",
			shot === undefined
				? "the adapter has no capture"
				: `${shot.width}x${shot.height} scale ${shot.scale}, ${shot.png.length} base64 chars`,
		);
		return verdict;
	} finally {
		if (open) platform.destroy(LABEL);
		platform.stopPump();
		server.stop(true);
	}
}

const frontmost = guardFocus();
let verdict: Verdict = { lines: [], failures: ["probe did not finish"] };
let code = 1;
try {
	verdict = await probe();
	// `guardFocus()` answered the target once; this is a fresh read, so the comparison is a real one.
	const after = await captureFrontmost();
	const same = frontmost !== undefined && frontmost === after;
	verdict.lines.push(
		`  ${same ? "ok  " : "FAIL"} ${"frontmost".padEnd(22)} ${frontmost} -> ${after}`,
	);
	if (!same) verdict.failures.push("frontmost changed");
	code = verdict.failures.length === 0 ? 0 : 1;
} catch (error) {
	verdict.lines.push(`  FAIL ${String(error instanceof Error ? error.message : error)}`);
} finally {
	console.log("focus-control probe");
	for (const line of verdict.lines) console.log(line);
	console.log(
		code === 0
			? "verdict  PASS  page driven and capture rendered with the front app unchanged"
			: `verdict  FAIL  ${verdict.failures.join(", ")}`,
	);
	await restoreFocus(frontmost);
}
process.exit(code);
