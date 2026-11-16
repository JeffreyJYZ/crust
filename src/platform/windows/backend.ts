/**
 * The native edge: probe the machine, compile the shim, end the process. Everything the platform
 * needs from Windows goes through this interface, which is what lets the five `Platform` methods be
 * tested on a machine that has no user32 — no test ever reaches a real Win32 symbol.
 */
import { existsSync, readdirSync } from "node:fs";
import { release } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { compile } from "./ffi.ts";
import type { WindowsRuntimeReport } from "./preflight.ts";

/**
 * The shim's exports, as `ffi.ts` declares them. Every one takes and returns a number, a byte buffer
 * or nothing: no COM pointer, no vtable and no struct ever crosses this boundary.
 *
 * Every `cstring` argument is a `Uint8Array` from `cstring()`, never a JavaScript string —
 * `bun:ffi` throws on a string at that argument before C runs.
 */
export interface WindowsShim {
	shim_com_init(): number;
	shim_last_error(): number;
	shim_register_class(name: Uint8Array): number;
	shim_pump(): number;
	shim_post_quit(): void;

	shim_window_new(
		title: Uint8Array,
		width: number,
		height: number,
		className: Uint8Array,
	): number;
	shim_window_is_open(hwnd: number): number;
	shim_window_set_title(hwnd: number, title: Uint8Array): number;
	shim_window_destroy(hwnd: number): number;
	shim_window_client_num(hwnd: number, component: number): number;

	shim_webview_new(hwnd: number, url: Uint8Array, userData: Uint8Array): number;
	shim_webview_put_bounds(hwnd: number, width: number, height: number): number;
	shim_webview_close(hwnd: number): void;
}

export interface WindowsBackend {
	/** Read the WebView2 runtime and the Windows build number without compiling anything. */
	probe(): WindowsRuntimeReport;
	/** Compile the shim and return its symbols; throws when the C unit will not build. */
	load(): WindowsShim;
	/** End the process. Injected so a test can watch a quit without exiting the runner. */
	exit(code: number): void;
}

/** Whether `WebView2Loader.dll` sits beside the executable or anywhere on `PATH`. */
function hasLoader(): boolean {
	const dirs = [dirname(process.execPath), ...(process.env.PATH ?? "").split(delimiter)];
	return dirs.some((dir) => dir !== "" && existsSync(join(dir, "WebView2Loader.dll")));
}

/**
 * The Evergreen runtime's version, read from its install directory. Numeric collation because a
 * plain sort puts `100.x` before `99.x`, which would report an old runtime as the newest.
 */
function coreVersion(): string | undefined {
	const root = process.env["ProgramFiles(x86)"] ?? process.env.ProgramFiles;
	if (!root) return undefined;
	const app = join(root, "Microsoft", "EdgeWebView", "Application");
	if (!existsSync(app)) return undefined;
	const versions = readdirSync(app).filter((name) => /^\d+\.\d+\.\d+/.test(name));
	if (versions.length === 0) return undefined;
	versions.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
	return versions[versions.length - 1];
}

/** The real backend: probe with the filesystem, compile on demand, exit with the OS. */
export function defaultBackend(): WindowsBackend {
	return {
		probe(): WindowsRuntimeReport {
			return {
				buildNumber: release(),
				loader: hasLoader(),
				coreVersion: coreVersion(),
			};
		},
		load: compile,
		exit(code: number): void {
			process.exit(code);
		},
	};
}
