#!/usr/bin/env bun
/**
 * The real GTK proof: `createPlatform()` against libgtk-3 and libwebkit2gtk-4.1, a window that
 * opens, and two pump slices. Every other linux test injects a fake backend, so this file is the
 * only place the shim's `dlopen` path runs against the libraries it names.
 *
 * Linux only, and it needs a display:
 *   xvfb-run --auto-servernum bun run scripts/linux-smoke.ts
 * On macOS it prints `unavailable:` and exits 1 rather than passing — GTK is not installed there,
 * so a green here would claim a proof this machine cannot give.
 *
 * What it does not claim: that a document loaded, that page JS ran, or that invoke crossed the
 * bridge. The window loads `about:blank` and nothing reads its content.
 */
import { createPlatform, preflightErrors } from "../src/platform/linux/index.ts";
import { Verdict } from "./e2e-harness.ts";

/** The shared call shape wants a config; GTK reads nothing from it before a window exists. */
const CONFIG = {
	app: { id: "dev.crust.smoke", name: "crust smoke", version: "0.0.0" },
	windows: [],
};

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<number> {
	const verdict = new Verdict();
	if (process.platform !== "linux") {
		console.log(
			`unavailable: this proves GTK3 + WebKitGTK through bun:ffi and needs Linux; ` +
				`running ${process.platform}/${process.arch}`,
		);
		return 1;
	}

	// 1. The libraries, through the same dlopen probe the platform runs at launch.
	const missing = preflightErrors();
	verdict.check(
		"preflight",
		missing.length === 0,
		missing.length === 0
			? "libgtk-3.so.0 and libwebkit2gtk-4.1.so.0 load, with the symbols the shim resolves"
			: missing.join(" · "),
	);
	if (missing.length > 0) return verdict.report("linux:smoke");

	// 2. GTK up. A failure here is the preflight text or the no-display message, and both are
	//    printed verbatim as the reason rather than summarised.
	const platform = createPlatform(CONFIG);
	try {
		await platform.start();
	} catch (error) {
		console.log(`unavailable: ${message(error)}`);
		verdict.check("gtk init", false, message(error));
		return verdict.report("linux:smoke");
	}
	verdict.check(
		"gtk init",
		true,
		`gtk_init_check returned 1 (DISPLAY=${process.env.DISPLAY ?? "unset"})`,
	);

	// 3. A real GtkWindow with a WebKitWebView inside it.
	try {
		platform.createWindow({
			label: "smoke",
			title: "crust smoke",
			url: "about:blank",
			width: 480,
			height: 320,
		});
	} catch (error) {
		console.log(`unavailable: ${message(error)}`);
		verdict.check("window", false, message(error));
		return verdict.report("linux:smoke");
	}
	verdict.check(
		"window",
		platform.window("smoke") !== undefined,
		"smoke: GtkWindow + WebKitWebView, shown, loading about:blank",
	);

	// 4. Two slices of the real main context, which is the pump a running app depends on.
	platform.pump(16);
	await Bun.sleep(120);
	const ticks = platform.ticks;
	platform.stopPump();
	verdict.check(
		"pump",
		ticks >= 2,
		`${ticks} g_main_context_iteration slices in 120 ms at a 16 ms interval`,
	);

	// 5. Liveness is read out of C, not from a freed widget: this is the call that would fault on
	//    a stale pointer if the slot table were wrong.
	verdict.check(
		"still open",
		platform.window("smoke") !== undefined,
		"shim_window_alive still answers 1 after the pump",
	);

	console.log(
		"not proven here: a loaded document, page JS, invoke — the window loads about:blank.",
	);
	return verdict.report("linux:smoke");
}

try {
	process.exit(await main());
} catch (error) {
	console.log(`linux:smoke: FAIL  ${message(error)}`);
	process.exit(1);
}
