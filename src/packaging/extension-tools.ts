/**
 * Toolchain facts shared by discovery, compilation and doctor: which extension maps to which compiler,
 * the argument each one answers for its version, and a `which` that scans `PATH` itself rather than
 * spawning `which` and parsing its exit code.
 */

import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import type { RunResult } from "./exec";

export type ExtensionKind = "zig" | "rust" | "c";
export type ExtensionTool = "zig" | "rustc" | "clang";

/** Runs one command; defaults to `exec.run`. Injected so tests record argv without a toolchain. */
export type ExtensionExec = (command: string[]) => Promise<RunResult>;

/**
 * The dylib suffix per platform. Every emitter names its output explicitly, so a macOS `.dylib` left on
 * Linux is a file `dlopen` never opens; win32's `LoadLibrary` wants `.dll`, and Darwin wants `.dylib`.
 * Shared here rather than in the compiler so the bindings generator names the same file.
 */
export function dylibSuffix(platform: string = process.platform): string {
	if (platform === "win32") return ".dll";
	if (platform === "darwin") return ".dylib";
	return ".so";
}

/** Resolves a tool to its absolute path, or undefined when it is absent. */
export type ToolLookup = (tool: string) => string | undefined;

/** The two seams every entry point accepts, so a test never needs a real compiler. */
export type ExtensionSeams = { exec?: ExtensionExec; findTool?: ToolLookup };

/** Extension → kind, and kind → the compiler that builds it. */
export const KIND: Record<string, ExtensionKind> = { ".zig": "zig", ".rs": "rust", ".c": "c" };
export const TOOL: Record<ExtensionKind, ExtensionTool> = { zig: "zig", rust: "rustc", c: "clang" };

/** zig answers `version`; the other two answer `--version`. */
export const VERSION_FLAG = { zig: "version", rustc: "--version", clang: "--version" } as const;

/**
 * The names a tool answers to on `platform`. Windows installs `zig.exe` and does not apply `PATHEXT`
 * inside `accessSync`, so the bare name alone finds nothing there; the caller gets the exact file it
 * should spawn.
 */
export function toolFileNames(name: string, platform: string = process.platform): string[] {
	return platform === "win32" ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`] : [name];
}

/** A `which` that does not spawn: the first executable `name` on `PATH`. */
export function findTool(
	name: string,
	path: string = process.env.PATH ?? "",
	platform: string = process.platform,
): string | undefined {
	const names = toolFileNames(name, platform);
	for (const dir of path.split(delimiter)) {
		if (dir.length === 0) continue;
		for (const file of names) {
			const candidate = join(dir, file);
			try {
				accessSync(candidate, constants.X_OK);
				return candidate;
			} catch {
				// Not in this directory (or not this name); the next one may hold it.
			}
		}
	}
	return undefined;
}
