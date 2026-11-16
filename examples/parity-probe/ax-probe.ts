/**
 * The external AX reader: a short-lived `bun` process, written to a content-hashed temp file, that
 * reads another pid's tree and prints one line.
 * Why not the app's own binary with an argv flag: a second launch of the bundle is caught by crust's
 * single-instance guard before any script runs, and that guard raises the running instance — an
 * activation, which this proof must never cause. A `bun` helper has no such guard.
 * Nothing here activates the app, asks for focus or sends input: it creates an AX element for a pid
 * and copies two attributes off it.
 */

import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AX_PROBE_SOURCE } from "./ax-probe-c.ts";

export interface ExternalAx {
	/** Windows the system AX server listed for that pid. */
	windows: number;
	/** Children of its first window, or -1 when there was no window to read. */
	children: number;
	/** The AXError of the window read: 0 means the call succeeded. */
	status: number;
}

/** A helper that hangs must not hold the run; ten seconds is a hang guard, not a path. */
const HELPER_TIMEOUT_MS = 10_000;

/**
 * The helper's whole source. Self-contained on purpose: a compiled app carries no readable copy of
 * this repo, so the script embeds the C text rather than importing it.
 */
const HELPER_SOURCE = [
	'import { cc, FFIType } from "bun:ffi";',
	'import { createHash } from "node:crypto";',
	'import { existsSync, writeFileSync } from "node:fs";',
	'import { tmpdir } from "node:os";',
	'import { join } from "node:path";',
	`const SOURCE = ${JSON.stringify(AX_PROBE_SOURCE)};`,
	"const pid = Number(process.argv[2]);",
	'const hash = createHash("sha256").update(SOURCE).digest("hex").slice(0, 16);',
	'const file = join(tmpdir(), "crust-parity-ax-" + hash + ".c");',
	"if (!existsSync(file)) writeFileSync(file, SOURCE);",
	"try {",
	"\tconst unit = cc({",
	"\t\tsource: file,",
	'\t\tflags: ["-framework", "ApplicationServices", "-framework", "CoreFoundation"],',
	"\t\tsymbols: {",
	"\t\t\tprobe_windows: { args: [FFIType.i32], returns: FFIType.i32 },",
	"\t\t\tprobe_status_value: { args: [], returns: FFIType.i32 },",
	"\t\t\tprobe_children_value: { args: [], returns: FFIType.i32 },",
	"\t\t},",
	"\t});",
	"\tconst windows = Number(unit.symbols.probe_windows(pid));",
	"\tconst children = Number(unit.symbols.probe_children_value());",
	"\tconst status = Number(unit.symbols.probe_status_value());",
	'\tconsole.log("windows=" + windows + " children=" + children + " status=" + status);',
	"} catch (error) {",
	'\tconsole.log("ax-probe failed: " + (error instanceof Error ? error.message : String(error)));',
	"\tprocess.exit(1);",
	"}",
].join("\n");

/** Content-hashed, so a run reuses the file and the next one never writes a different script. */
function helperPath(): string {
	const hash = createHash("sha256").update(HELPER_SOURCE).digest("hex").slice(0, 16);
	const file = join(tmpdir(), `crust-parity-ax-helper-${hash}.mjs`);
	if (!existsSync(file)) writeFileSync(file, HELPER_SOURCE);
	return file;
}

/**
 * Run the helper as a separate trusted process and parse its one line. A string is the reason it
 * could not run, which the proof reports as a refusal rather than as a zero-window finding.
 */
export async function externalAx(pid: number): Promise<ExternalAx | string> {
	const bun = Bun.which("bun");
	if (bun === null) return "no bun on PATH to run the AX helper";
	try {
		const child = Bun.spawn([bun, helperPath(), String(pid)], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const timer = setTimeout(() => child.kill(), HELPER_TIMEOUT_MS);
		try {
			const text = await new Response(child.stdout).text();
			const errors = await new Response(child.stderr).text();
			await child.exited;
			const found = text.match(/windows=(-?\d+) children=(-?\d+) status=(-?\d+)/);
			if (found === null) {
				const why = (text.trim() || errors.trim()).slice(0, 160);
				return `the helper printed no parseable line: ${why || "nothing"}`;
			}
			return {
				windows: Number(found[1] ?? -1),
				children: Number(found[2] ?? -1),
				status: Number(found[3] ?? -999),
			};
		} finally {
			clearTimeout(timer);
		}
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}
