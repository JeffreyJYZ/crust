/**
 * Compiling one native source into a dylib. The three command lines are the whole toolchain contract:
 * each emits into `outDir` under the exact name `bun:ffi` will later dlopen, and `rustc` is the only one
 * that prefixes a cdylib with `lib`. A missing compiler is a verdict, never a thrown error, so a build
 * that needs no extension still passes on a machine with no toolchain installed.
 */

import { mkdir } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import {
	type ExtensionKind,
	type ExtensionSeams,
	type ExtensionTool,
	KIND,
	dylibSuffix,
	findTool,
} from "./extension-tools";
import { run } from "./exec";

/** `output` is the absolute path of the emitted dylib. */
export type ExtensionBuilt = { ok: true; file: string; output: string; tool: ExtensionTool };

/** `requires` names the missing tools, so a caller can print one install hint per entry. */
export type ExtensionFailed = { ok: false; file: string; reason: string; requires: string[] };

export type CompileExtensionResult = ExtensionBuilt | ExtensionFailed;

/** `platform` is injected so a test can assert a Linux or Windows command line without one. */
export type CompileExtensionOptions = {
	file: string;
	outDir: string;
	platform?: string;
} & ExtensionSeams;

/**
 * `dylibSuffix` lives in `extension-tools` so the compiler, the bindings generator and the e2e agree on
 * the file name; the barrel re-exports it from there, not from here.
 */

/** `rustc` names a cdylib `lib<stem>` on unix; zig, clang and every Windows emitter take the stem. */
export function dylibName(
	file: string,
	kind: ExtensionKind,
	platform: string = process.platform,
): string {
	const stem = basename(file, extname(file));
	const base = kind === "rust" && platform !== "win32" ? `lib${stem}` : stem;
	return `${base}${dylibSuffix(platform)}`;
}

/** The exact argv for one file, so a caller can print the command without running it. */
export function extensionCommand(
	file: string,
	kind: ExtensionKind,
	outDir: string,
	platform: string = process.platform,
): { tool: ExtensionTool; argv: string[] } {
	const out = join(outDir, dylibName(file, kind, platform));
	if (kind === "zig") {
		// `-femit-bin` carries the suffix on purpose: zig adds none on macOS or Linux.
		return {
			tool: "zig",
			argv: ["zig", "build-lib", file, "-dynamic", `-femit-bin=${out}`, "-O", "ReleaseSafe"],
		};
	}
	if (kind === "rust") {
		return { tool: "rustc", argv: ["rustc", "--crate-type", "cdylib", "-O", "-o", out, file] };
	}
	// `-dynamiclib` exists only in Apple's clang; the shared-object flag is `-shared` elsewhere.
	const shared = platform === "darwin" ? "-dynamiclib" : "-shared";
	return { tool: "clang", argv: ["clang", shared, "-o", out, file] };
}

/** Compile one source file to a dylib. A missing toolchain is a verdict, not a thrown error. */
export async function compileExtension(
	options: CompileExtensionOptions,
): Promise<CompileExtensionResult> {
	const file = resolve(options.file);
	const kind = KIND[extname(file)];
	const stem = basename(file);
	if (!kind) return { ok: false, file, reason: `${stem} is not .zig, .rs or .c`, requires: [] };

	const platform = options.platform ?? process.platform;
	const outDir = resolve(options.outDir);
	const { tool, argv } = extensionCommand(file, kind, outDir, platform);
	if ((options.findTool ?? findTool)(tool) === undefined) {
		const reason = `${tool} is not on PATH, so ${stem} cannot be built`;
		return { ok: false, file, reason, requires: [tool] };
	}

	await mkdir(outDir, { recursive: true });
	const result = await (options.exec ?? run)(argv);
	if (result.code !== 0) {
		const detail = (result.stderr.trim() || result.stdout.trim() || "no output")
			.split("\n")
			.join(" | ");
		const reason = `${tool} failed (exit ${result.code}): ${detail}`;
		return { ok: false, file, reason, requires: [] };
	}
	return { ok: true, file, output: join(outDir, dylibName(file, kind, platform)), tool };
}
