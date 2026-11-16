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

/** Resolves a tool to its absolute path, or undefined when it is absent. */
export type ToolLookup = (tool: string) => string | undefined;

/** The two seams every entry point accepts, so a test never needs a real compiler. */
export type ExtensionSeams = { exec?: ExtensionExec; findTool?: ToolLookup };

/** Extension → kind, and kind → the compiler that builds it. */
export const KIND: Record<string, ExtensionKind> = { ".zig": "zig", ".rs": "rust", ".c": "c" };
export const TOOL: Record<ExtensionKind, ExtensionTool> = { zig: "zig", rust: "rustc", c: "clang" };

/** zig answers `version`; the other two answer `--version`. */
export const VERSION_FLAG = { zig: "version", rustc: "--version", clang: "--version" } as const;

/** A `which` that does not spawn: the first executable `name` on `PATH`. */
export function findTool(name: string, path: string = process.env.PATH ?? ""): string | undefined {
	for (const dir of path.split(delimiter)) {
		if (dir.length === 0) continue;
		const candidate = join(dir, name);
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
			// Not in this directory; the next one may hold it.
		}
	}
	return undefined;
}
