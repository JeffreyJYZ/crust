/**
 * What a Windows machine must have before a crust window can exist: the WebView2 runtime, and every
 * Win32 and COM entry point the shim calls. Probed, never assumed — WebView2 is a separate install
 * on Windows 10 and a different build on every machine, and an unresolvable export is a crash with
 * no JavaScript error to catch.
 */

/** Microsoft's Evergreen Bootstrapper: the remedy when the runtime is absent. */
export const WEBVIEW2_BOOTSTRAPPER_URL = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

/** One entry point, and what breaks when the machine does not export it. */
export interface PreflightEntry {
	module: string;
	symbol: string;
	breaks: string;
}

const win32: ReadonlyArray<readonly [string, string, string]> = [
	["user32.dll", "RegisterClassExW", "no window class, so every CreateWindowExW is refused"],
	["user32.dll", "CreateWindowExW", "no window at all"],
	["user32.dll", "DestroyWindow", "a close leaves the window and its controller alive"],
	["user32.dll", "IsWindow", "liveness cannot be read, so a closed window stays addressable"],
	["user32.dll", "ShowWindow", "the window is created and never shown"],
	["user32.dll", "UpdateWindow", "the first paint is delayed until an unrelated message"],
	[
		"user32.dll",
		"GetClientRect",
		"the controller never gets bounds, so the page renders nowhere",
	],
	["user32.dll", "SetWindowTextW", "the title stays the class default"],
	["user32.dll", "PeekMessageW", "the pump drains nothing"],
	["user32.dll", "TranslateMessage", "no keyboard input reaches the page"],
	["user32.dll", "DispatchMessageW", "no window procedure runs, so no close and no resize"],
	["user32.dll", "DefWindowProcW", "unhandled messages fault the window procedure"],
	["user32.dll", "PostQuitMessage", "the pump cannot be ended"],
	["user32.dll", "LoadCursorW", "the window has no cursor over its client area"],
	["kernel32.dll", "GetModuleHandleW", "CreateWindowExW has no instance to register against"],
	["kernel32.dll", "GetLastError", "a failure reports no reason"],
	["kernel32.dll", "MultiByteToWideChar", "no string reaches Win32, so no title and no URL"],
	["kernel32.dll", "GetCurrentThreadId", "no step can be attributed to a thread"],
	["kernel32.dll", "GetTickCount64", "the WebView2 wait has no timeout"],
	["kernel32.dll", "VirtualQuery", "a bad vtable slot cannot be refused safely"],
	["kernel32.dll", "LoadLibraryW", "the WebView2 loader cannot be loaded by name"],
	["kernel32.dll", "Sleep", "the WebView2 wait spins without yielding"],
	["ole32.dll", "CoInitializeEx", "WebView2 cannot create its controller"],
	["ole32.dll", "CoGetApartmentType", "the apartment a WebView2 call runs in cannot be read"],
	[
		"user32.dll",
		"GetWindowThreadProcessId",
		"the window's own thread cannot be compared with the caller's",
	],
	["WebView2Loader.dll", "CreateCoreWebView2EnvironmentWithOptions", "no WebView2 environment"],
];

/** Every entry point the shim calls, checked before a window is attempted. */
export const PREFLIGHT: readonly PreflightEntry[] = win32.map(([module, symbol, breaks]) => ({
	module,
	symbol,
	breaks,
}));

/** Answers whether one export resolves on this machine. Injected so the scan is testable off Windows. */
export type SymbolResolver = (module: string, symbol: string) => boolean;

/** `module!symbol` for each entry the resolver could not find, in table order. */
export function missingEntryPoints(
	entries: readonly PreflightEntry[],
	resolves: SymbolResolver,
): string[] {
	return entries
		.filter(({ module, symbol }) => !resolves(module, symbol))
		.map(({ module, symbol }) => `${module}!${symbol}`);
}

/**
 * What a probe found. `loader` and `coreVersion` are two separate facts because the loader can ship
 * beside the binary while the runtime behind it is absent, and the remedy differs: the bootstrapper
 * fixes the runtime, nothing fixes a missing loader but shipping it.
 */
export interface WindowsRuntimeReport {
	/** `os.release()`, e.g. `"10.0.22631"`. */
	buildNumber: string;
	/** `WebView2Loader.dll`, found beside the executable or on `PATH`. */
	loader: boolean;
	/** The Evergreen runtime's version, when its install directory exists. */
	coreVersion?: string;
	/** `module!symbol` names a probe could not resolve. */
	missing?: readonly string[];
}

/**
 * Name everything that is missing in one message, or `undefined` when the machine is ready. Returns
 * a string rather than throwing so `start()` can report a whole machine instead of the first gap.
 */
export function preflightError(report: WindowsRuntimeReport): string | undefined {
	const absent: string[] = [];
	if (!report.loader) absent.push("WebView2Loader.dll");
	if (!report.coreVersion) absent.push("Microsoft.Web.WebView2.Core");
	const lines: string[] = [];
	if (absent.length > 0) {
		lines.push(
			`crust: the WebView2 runtime is missing (${absent.join(" / ")}) on Windows build ${report.buildNumber}.`,
		);
		lines.push(`Install the Evergreen Bootstrapper: ${WEBVIEW2_BOOTSTRAPPER_URL}`);
	}
	const unresolved = report.missing ?? [];
	if (unresolved.length > 0) {
		lines.push(
			`crust: ${unresolved.length} entry point(s) did not resolve on Windows build ${report.buildNumber}:`,
		);
		for (const name of unresolved) lines.push(`  ${name}`);
	}
	return lines.length > 0 ? lines.join("\n") : undefined;
}
