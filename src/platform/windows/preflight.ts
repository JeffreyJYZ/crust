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
	["user32.dll", "GetWindowRect", "window.getSize and window.getPosition have no frame to read"],
	[
		"user32.dll",
		"SetWindowPos",
		"window.setSize and window.setPosition cannot move or resize the window",
	],
	["user32.dll", "IsIconic", "window.isMinimized cannot be read"],
	["user32.dll", "IsZoomed", "window.isMaximized cannot be read"],
	["user32.dll", "SetForegroundWindow", "window.focus cannot raise the window"],
	["user32.dll", "PeekMessageW", "the pump drains nothing"],
	["user32.dll", "TranslateMessage", "no keyboard input reaches the page"],
	["user32.dll", "DispatchMessageW", "no window procedure runs, so no close and no resize"],
	["user32.dll", "DefWindowProcW", "unhandled messages fault the window procedure"],
	["user32.dll", "PostQuitMessage", "the pump cannot be ended"],
	[
		"user32.dll",
		"PostMessageW",
		"a queued message cannot be posted, so pump liveness is unprovable",
	],
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
	["user32.dll", "EnumDisplayMonitors", "the display list cannot be enumerated"],
	["user32.dll", "GetMonitorInfoW", "a display is enumerated with no bounds"],
	// The window style, opacity, placement and pointer calls (`11_win32_style.c`, `45`/`49`). Each is
	// one member of `window` and `positioner`: a machine missing one refuses that member by name.
	[
		"user32.dll",
		"GetWindowLongPtrW",
		"always-on-top, decorations and fullscreen cannot be read back",
	],
	["user32.dll", "SetWindowLongPtrW", "decorations and fullscreen cannot change the style"],
	["user32.dll", "SetLayeredWindowAttributes", "window.setOpacity cannot set an alpha"],
	["user32.dll", "GetLayeredWindowAttributes", "window.opacity cannot read the alpha back"],
	[
		"user32.dll",
		"GetWindowPlacement",
		"a minimised or maximised window has no restore frame to read",
	],
	["user32.dll", "SetCursor", "window.setCursor cannot change the pointer"],
	["user32.dll", "ShowCursor", "window.setCursorVisible cannot hide the pointer"],
	[
		"user32.dll",
		"MonitorFromWindow",
		"window.setFullscreen cannot find the monitor the window covers",
	],
	["WebView2Loader.dll", "CreateCoreWebView2EnvironmentWithOptions", "no WebView2 environment"],
	// The three namespaces a normal app reaches first: `11_pointer_core.c` plus `50`–`52`. Each one
	// fails its own command by name rather than the whole launch, so a machine missing one is a
	// sentence and not a crash.
	[
		"user32.dll",
		"OpenClipboard",
		"clipboard.read and clipboard.write cannot reach the clipboard",
	],
	["user32.dll", "CloseClipboard", "the clipboard stays locked, so no other process can copy"],
	["user32.dll", "EmptyClipboard", "a write leaves the previous text on the clipboard"],
	["user32.dll", "GetClipboardData", "clipboard.read has no text to read"],
	["user32.dll", "SetClipboardData", "clipboard.write cannot put text on the clipboard"],
	["kernel32.dll", "GlobalAlloc", "clipboard.write has no block to hand to the clipboard"],
	["kernel32.dll", "GlobalLock", "the clipboard block can be neither read nor filled"],
	["kernel32.dll", "GlobalUnlock", "the clipboard block stays locked after every call"],
	["kernel32.dll", "GlobalFree", "a refused clipboard write leaks its block"],
	["kernel32.dll", "GetUserDefaultLocaleName", "os.info cannot report the user's locale"],
	["shell32.dll", "ShellExecuteW", "opener.openPath and opener.openUrl cannot reach the shell"],
	["ntdll.dll", "RtlGetVersion", "os.info cannot report the Windows version"],
	// The file panels. Only a pick needs them, and a machine missing one still launches an app:
	// `shim_dialog_missing` names it and `dialog` refuses that namespace alone.
	["comdlg32.dll", "GetOpenFileNameW", "dialog.openPanel has no file panel"],
	["comdlg32.dll", "GetSaveFileNameW", "dialog.savePanel has no save panel"],
	["comdlg32.dll", "CommDlgExtendedError", "a refused panel cannot be told from a cancel"],
	["shell32.dll", "SHBrowseForFolderW", "dialog.openPanel cannot pick a folder"],
	["shell32.dll", "SHGetPathFromIDListW", "a picked folder has no path to read"],
	["kernel32.dll", "WideCharToMultiByte", "no panel answer reaches JavaScript as text"],
	["ole32.dll", "CoTaskMemFree", "every picked folder leaks its PIDL"],
	// The preview host. `AssocQueryStringW` and `SHCreateStreamOnFileEx` are shlwapi rather than
	// shell32, and they are bound on first use by `54_preview.c`: a machine missing one refuses
	// `preview` by name instead of failing at the first window.
	[
		"shlwapi.dll",
		"AssocQueryStringW",
		"preview.show cannot find the handler registered for a file type",
	],
	[
		"shlwapi.dll",
		"SHCreateStreamOnFileEx",
		"a handler that accepts only a stream cannot be initialised",
	],
	[
		"shell32.dll",
		"SHCreateItemFromParsingName",
		"a handler that accepts only a shell item cannot be initialised",
	],
	["ole32.dll", "CoCreateInstance", "preview.show cannot create a registered preview handler"],
	["ole32.dll", "CLSIDFromString", "a registered handler's class id cannot be read"],
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
