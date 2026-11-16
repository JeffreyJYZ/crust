#!/usr/bin/env bun
/**
 * The real WebView2 proof: `defaultBackend().probe()` against the machine's runtime, then
 * `createPlatform()` creating a Win32 window and a WebView2 controller, pumped twice. Every other
 * windows test injects a fake backend, so this file is the only place user32, ole32 and
 * WebView2Loader.dll are actually called.
 *
 * Windows only. On macOS it prints `unavailable:` and exits 1 rather than passing — there is no
 * user32 there, so a green here would claim a proof this machine cannot give.
 *
 * WebView2Loader.dll ships with the WebView2 SDK, not with the Evergreen runtime, so a runner can
 * have the runtime and still fail the probe. When that happens this script copies the loader out
 * of an Edge install into a temp dir and puts that dir on `PATH` — printing exactly what it did —
 * because the loader must be resolvable both by `cc()`'s `-lWebView2Loader` and at load time.
 *
 * What it does not claim: that a document loaded, that page JS ran, or that invoke crossed the
 * bridge. The window navigates to `about:blank` and nothing reads its content.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { createPlatform, defaultBackend, preflightError } from "../src/platform/windows/index.ts";
import { Verdict } from "./e2e-harness.ts";

/** WebView2's user-data folder; explicit so a runner never writes into a profile it cannot own. */
const USER_DATA = join(tmpdir(), "crust-smoke-webview2");

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Every Edge install that might carry the loader, bounded to a fixed list of directories. */
function loaderRoots(): string[] {
	const bases = [
		process.env["ProgramFiles(x86)"],
		process.env.ProgramFiles,
		process.env.LOCALAPPDATA,
	]
		.filter((base): base is string => Boolean(base))
		.filter((base) => existsSync(base));
	return bases.flatMap((base) => [
		join(base, "Microsoft", "Edge", "Application"),
		join(base, "Microsoft", "EdgeWebView", "Application"),
	]);
}

/** The first `WebView2Loader.dll` in one of those installs, version subdirectories included. */
function findLoader(): string | undefined {
	for (const root of loaderRoots()) {
		if (!existsSync(root)) continue;
		const direct = join(root, "WebView2Loader.dll");
		if (existsSync(direct)) return direct;
		for (const entry of readdirSync(root)) {
			const candidate = join(root, entry, "WebView2Loader.dll");
			if (existsSync(candidate)) return candidate;
		}
	}
	return undefined;
}

/** Copy the loader somewhere stable and make it resolvable by both tcc and LoadLibrary. */
function stageLoader(found: string): string {
	const dir = join(tmpdir(), "crust-webview2");
	mkdirSync(dir, { recursive: true });
	copyFileSync(found, join(dir, "WebView2Loader.dll"));
	process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ""}`;
	return dir;
}

async function main(): Promise<number> {
	const verdict = new Verdict();
	if (process.platform !== "win32") {
		console.log(
			`unavailable: this proves Win32 + WebView2 through bun:ffi and needs Windows; ` +
				`running ${process.platform}/${process.arch}`,
		);
		return 1;
	}

	// 1. The runtime, read from the filesystem the way the platform reads it at launch.
	const backend = defaultBackend();
	let report = backend.probe();
	if (!report.loader) {
		const found = findLoader();
		if (found) {
			const dir = stageLoader(found);
			console.log(`loader    staged ${found} into ${dir} and prepended it to PATH`);
			report = backend.probe();
		}
	}
	verdict.check(
		"runtime",
		report.coreVersion !== undefined,
		report.coreVersion === undefined
			? `no Evergreen runtime under Microsoft/EdgeWebView/Application (build ${report.buildNumber})`
			: `WebView2 ${report.coreVersion} on Windows ${report.buildNumber}`,
	);
	verdict.check(
		"loader",
		report.loader,
		report.loader
			? "WebView2Loader.dll is beside the executable or on PATH"
			: "WebView2Loader.dll is absent — the shim's -lWebView2Loader cannot link without it",
	);

	// The probe names the runtime and the loader only; the shim's own compile is what proves each
	// Win32 and COM export, so a missing entry point surfaces as a compile failure below.
	const missing = preflightError(report);
	if (missing) {
		console.log(`unavailable: ${missing}`);
		verdict.check("preflight", false, missing.split("\n")[0] ?? missing);
		return verdict.report("windows:smoke");
	}
	verdict.check("preflight", true, "the runtime and loader the shim needs are both present");

	// 2. COM, the window class, then a real window and controller. A machine that refuses any of
	//    these reports the refusal verbatim instead of a stack trace.
	const platform = createPlatform({ appName: "crust-smoke", userDataDir: USER_DATA });
	await platform.start();
	if (platform.unavailable) {
		console.log(`unavailable: ${platform.unavailable}`);
		verdict.check(
			"com + class",
			false,
			platform.unavailable.split("\n")[0] ?? platform.unavailable,
		);
		return verdict.report("windows:smoke");
	}
	verdict.check(
		"com + class",
		true,
		`CoInitializeEx and RegisterClassExW("crust-smoke") succeeded`,
	);

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
		return verdict.report("windows:smoke");
	}
	const hwnd = platform.nativeWindow("smoke") ?? 0;
	verdict.check(
		"window",
		hwnd > 0 && platform.window("smoke") !== undefined,
		`smoke: HWND ${hwnd} with a WebView2 controller, navigated to about:blank`,
	);

	// 3. Two slices of the real message loop, which is the pump a running app depends on.
	platform.pump(16);
	await Bun.sleep(120);
	const ticks = platform.ticks;
	platform.stopPump();
	verdict.check("pump", ticks >= 2, `${ticks} PeekMessageW slices in 120 ms at a 16 ms interval`);

	// 4. Liveness is `IsWindow`, read from user32 rather than from a freed handle.
	verdict.check(
		"still open",
		platform.window("smoke") !== undefined,
		"shim_window_is_open still answers 1 after the pump",
	);

	console.log(
		"not proven here: a loaded document, page JS, invoke — the window loads about:blank.",
	);
	return verdict.report("windows:smoke");
}

try {
	process.exit(await main());
} catch (error) {
	console.log(`windows:smoke: FAIL  ${message(error)}`);
	process.exit(1);
}
