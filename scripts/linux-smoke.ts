#!/usr/bin/env bun
/**
 * The real GTK proof: `createPlatform()` against libgtk-3 and libwebkit2gtk-4.1, a window that
 * opens, the app's own bridge served into its webview, page JS evaluated through
 * `webkit_web_view_evaluate_javascript`, and one `window.crust.invoke` crossing back to the host.
 * Every other linux test injects a fake backend, so this file is the only place the shim's `dlopen`
 * path runs against the libraries it names.
 *
 * Linux only, and it needs a display:
 *   xvfb-run --auto-servernum bun run scripts/linux-smoke.ts
 * On macOS it prints `unavailable:` and exits 1 rather than passing — GTK is not installed there,
 * so a green here would claim a proof this machine cannot give.
 *
 * What it does not claim: the app's built frontend (the document here is the bridge's own), the
 * event stream, or any plugin's effect on the machine. `invoke` is proven against one handler.
 */
import {
	createGtkBackend,
	createPlatform,
	type NativeWindow,
	preflightErrors,
	shim,
} from "../src/platform/linux/index.ts";
import { Verdict } from "./e2e-harness.ts";
import { DATA_PAGE_URL, type ProofPage, startProofPage } from "./linux/proof-page.ts";
import {
	documentStep,
	failureStep,
	invokeStep,
	jsStep,
	MISSING_FILE_URL,
} from "./linux/proof-steps.ts";

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

	// 2. The page comes first, because the window loads the bridge's own URL. A bridge that will
	//    not start is reported at the invoke step in its own words, never as a fake answer.
	let page: ProofPage | undefined;
	let pageError = "";
	try {
		page = startProofPage();
	} catch (error) {
		pageError = message(error);
	}
	const url = page?.url ?? DATA_PAGE_URL;

	// 3. GTK up. A failure here is the preflight text or the no-display message, and both are
	//    printed verbatim as the reason rather than summarised.
	const backend = createGtkBackend();
	let native: NativeWindow | undefined;
	const platform = createPlatform(CONFIG, {
		...backend,
		createWindow(options, target) {
			native = backend.createWindow(options, target);
			return native;
		},
	});
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

	// 4. A real GtkWindow with a WebKitWebView inside it, loading the page.
	try {
		platform.createWindow({
			label: "smoke",
			title: "crust smoke",
			url,
			width: 480,
			height: 320,
		});
	} catch (error) {
		console.log(`unavailable: ${message(error)}`);
		verdict.check("window", false, message(error));
		return verdict.report("linux:smoke");
	}
	const web = native?.web ?? 0n;
	verdict.check(
		"window",
		platform.window("smoke") !== undefined && web !== 0n,
		`smoke: GtkWindow + WebKitWebView, shown, loading ${page === undefined ? "a data: URL" : url}`,
	);

	// 5. Two slices of the real main context, which is the pump a running app depends on.
	platform.pump(16);
	await Bun.sleep(120);
	const ticks = platform.ticks;
	verdict.check(
		"pump",
		ticks >= 2,
		`${ticks} g_main_context_iteration slices in 120 ms at a 16 ms interval`,
	);

	// 6. The loaded document, then its scripts, then one invoke. The pump stays armed from here on:
	//    a load and every evaluation are work the main context has to dispatch, so without it
	//    nothing would reach FINISHED.
	platform.pump(8);
	const symbols = shim().symbols;
	const loaded = await documentStep(symbols, web);
	verdict.check("document", loaded.ok, loaded.detail);
	const evaluated = await jsStep(symbols, web);
	verdict.check("js", evaluated.ok, evaluated.detail);
	const invoked = await invokeStep(symbols, web, page, pageError);
	verdict.check("invoke", invoked.ok, invoked.detail);

	// 7. A load that must fail: WebKit answers `load-failed` and the shim records its message, so
	//    the error path is a printed line rather than a pump that never settles.
	platform.createWindow({
		label: "broken",
		title: "crust smoke broken",
		url: MISSING_FILE_URL,
		width: 320,
		height: 200,
	});
	const failure = await failureStep(symbols);
	verdict.check("failure", failure.ok, failure.detail);

	// 8. Liveness is read out of C, not from a freed widget: this is the call that would fault on a
	//    stale pointer if the slot table were wrong.
	verdict.check(
		"still open",
		platform.window("smoke") !== undefined,
		"shim_window_alive still answers 1 after the pump and the page's own calls",
	);

	platform.stopPump();
	if (page !== undefined) await page.stop();

	console.log(
		"not proven here: the app's built frontend, the event stream, and any plugin's effect on the machine.",
	);
	return verdict.report("linux:smoke");
}

try {
	process.exit(await main());
} catch (error) {
	console.log(`linux:smoke: FAIL  ${message(error)}`);
	process.exit(1);
}
