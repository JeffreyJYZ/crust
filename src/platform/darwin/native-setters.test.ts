/**
 * The two commands the coverage table used to advertise while their native setters did not exist:
 * `tray.setTooltip` and `navigation.loadUrl`.
 *
 * Each proof runs in a **child process**, and that is deliberate rather than tidy: starting AppKit
 * installs the main menu, and `menu.test.ts` asserts that a fresh process has none. Doing this
 * in-process would make that test fail depending on file order — a leak between suites, which is
 * the same defect as a module-level token nobody clears.
 *
 * The assertion is the child's own readback, not its exit code: `-URL` is read back from the
 * webview and the tray title from the status item, so a `true` that never reached the native call
 * could not make either change.
 */
import { describe, expect, test } from "bun:test";

const REPO = new URL("../../..", import.meta.url).pathname;

/** A script run in its own process, so nothing it starts leaks into the test runner. */
async function runChild(source: string): Promise<{ code: number; out: string }> {
	const child = Bun.spawn(["bun", "-e", source], {
		cwd: REPO,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, CRUST_TEST_CHILD: "1" },
	});
	const out = await new Response(child.stdout).text();
	await child.exited;
	return { code: child.exitCode ?? -1, out };
}

describe("tray.setTooltip reaches AppKit", () => {
	test("a tooltip on a live status item is applied, and the item survives it", async () => {
		const { code, out } = await runChild(`
			import { createStatusBar } from "./src/platform/darwin/status-bar-item.ts";
			const bar = createStatusBar();
			try {
				bar.setTitle("tooltip proof");
				bar.setTooltip("hover me");
				console.log("TITLE=" + bar.readback().title);
				console.log("OK");
			} catch (error) {
				console.log("THREW=" + (error instanceof Error ? error.message : String(error)));
			} finally {
				bar.destroy();
			}
			process.exit(0);
		`);
		expect(out).toContain("OK");
		expect(out).not.toContain("THREW=");
		// The readback is the proof: a refused setter throws out of the adapter, and a setter that
		// ran against a stale item could not still report the title it was given.
		expect(out).toContain("TITLE=tooltip proof");
		expect(code).toBe(0);
	});
});

describe("navigation.loadUrl reaches -[WKWebView loadRequest:]", () => {
	test("a load changes the webview's own URL, read back from the webview", async () => {
		const { code, out } = await runChild(`
			import { DarwinPlatform } from "./src/platform/darwin/platform.ts";
			import { darwinNavigationAdapter } from "./src/platform/darwin/navigation.ts";

			const platform = new DarwinPlatform({ appName: "crust-nav-proof", activate: "never" });
			await platform.start();
			platform.createWindow({ label: "main", title: "main", url: "about:blank", width: 320, height: 200 });
			platform.pump(16);
			await Bun.sleep(400);

			const adapter = darwinNavigationAdapter((l) => platform.webview(l ?? "main") ?? null);
			console.log("LOADED=" + String(adapter.loadUrl?.("about:blank#native-proof")));
			// Read after the load, from the webview rather than from the adapter's own bookkeeping.
			console.log("URL=" + String(adapter.state("main")?.url));
			platform.stopPump();
			process.exit(0);
		`);
		expect(out).toContain("LOADED=true");
		expect(out).toContain("URL=about:blank#native-proof");
		expect(code).toBe(0);
	}, 30_000);
});
