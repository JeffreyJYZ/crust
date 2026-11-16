/**
 * The read-only verdict `crust doctor` prints for native extensions: which of the three compilers are on
 * `PATH`, what each answers for its version, and whether every source file in `native/` can be built.
 * Nothing is compiled and no dylib is written, so a project with a missing toolchain still gets a report
 * instead of a failed build.
 */

import { resolve } from "node:path";
import { discoverExtensions } from "./extension-discover";
import {
	type ExtensionKind,
	type ExtensionSeams,
	type ExtensionTool,
	TOOL,
	VERSION_FLAG,
	findTool,
} from "./extension-tools";
import { run } from "./exec";

/** `version` is the first line of `<tool> --version`, empty when the tool is absent or refused. */
export type ToolchainReport = { tool: ExtensionTool; found: boolean; version: string };

export type ExtensionVerdict = { file: string; kind: ExtensionKind; ok: boolean; detail: string };

export type ExtensionsDoctor = { dir: string } & {
	toolchains: ToolchainReport[];
	files: ExtensionVerdict[];
};

export type DoctorExtensionsOptions = { dir?: string } & ExtensionSeams;

/** Per-toolchain presence plus a per-file verdict. Builds nothing. */
export async function doctorExtensions(
	options: DoctorExtensionsOptions = {},
): Promise<ExtensionsDoctor> {
	const exec = options.exec ?? run;
	const lookup = options.findTool ?? findTool;
	const found = await discoverExtensions({ dir: options.dir });

	const toolchains: ToolchainReport[] = [];
	for (const tool of ["zig", "rustc", "clang"] as const) {
		if (lookup(tool) === undefined) {
			toolchains.push({ tool, found: false, version: "" });
			continue;
		}
		const result = await exec([tool, VERSION_FLAG[tool]]);
		const text = (result.code === 0 ? result.stdout || result.stderr : "").trim();
		toolchains.push({ tool, found: true, version: text.split("\n")[0]?.trim() ?? "" });
	}

	const byTool = new Map(toolchains.map((entry) => [entry.tool, entry]));
	const files: ExtensionVerdict[] = [];
	for (const kind of ["zig", "rust", "c"] as const) {
		const report = byTool.get(TOOL[kind]);
		const detail = report?.found
			? `${TOOL[kind]} ${report.version || "(no version)"} can build it`
			: `${TOOL[kind]} is not on PATH`;
		for (const file of found[kind])
			files.push({ file, kind, ok: report?.found === true, detail });
	}
	files.sort((a, b) => a.file.localeCompare(b.file));
	return { dir: resolve(options.dir ?? "native"), toolchains, files };
}

/** The doctor block, one line per toolchain and one per source file. */
export function describeExtensions(report: ExtensionsDoctor): string {
	const lines = [`extensions  ${report.files.length} file(s) in ${report.dir}`];
	for (const entry of report.toolchains) {
		const state = entry.found ? `found ${entry.version || "(no version)"}` : "missing";
		lines.push(`  ${entry.tool.padEnd(6)} ${state}`);
	}
	for (const entry of report.files) {
		lines.push(`  ${(entry.ok ? "ok" : "missing").padEnd(7)} ${entry.file}  ${entry.detail}`);
	}
	return lines.join("\n");
}
