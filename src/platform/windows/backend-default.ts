/**
 * The real WindowsBackend: probe the filesystem and the registry-free facts, compile on demand, exit
 * with the OS. Split from backend.ts when that file outgrew the line cap — the contract (the two
 * interfaces) is the part a reader needs first, and this is the part that touches the machine.
 */
import { existsSync, readdirSync } from "node:fs";
import { release } from "node:os";
import { delimiter, dirname, join } from "node:path";
import type { WindowsBackend } from "./backend.ts";
import { compile } from "./ffi.ts";
import type { WindowsRuntimeReport } from "./preflight.ts";
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
