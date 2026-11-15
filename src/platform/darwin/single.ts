/**
 * macOS half of `crust:single-instance`: `NSRunningApplication` is the only API that raises another running copy, and it needs no window, so the unit compiles on its own rather than through the window shim.
 * Status codes are the C unit's (`shim/94_single.c`), mapped to a reason here so the plugin only has to know that 0 means activated.
 */

import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActivatePost, SingleInstanceAdapter } from "@/plugins/single-instance";

// A compiled binary has no `import.meta.dir`, so the C unit travels inside the
// binary as text and is materialised before `cc()` sees it.
import source from "./shim/94_single.c" with { type: "text" };

/** The C unit's answers; `activated` is the only one the system accepted. */
export const SINGLE_STATUS = {
	activated: 0,
	noProcess: 1,
	missing: 2,
	refused: 3,
	badPid: 4,
} as const;

const REASONS: Record<number, string> = {
	[SINGLE_STATUS.activated]: "the running instance was activated",
	[SINGLE_STATUS.noProcess]: "no running application has that pid",
	[SINGLE_STATUS.missing]: "AppKit is missing NSRunningApplication or its selector",
	[SINGLE_STATUS.refused]: "the system refused the activation",
	[SINGLE_STATUS.badPid]: "the pid is not usable",
};

interface SingleUnit {
	symbols: {
		shim_single_activate: (pid: number) => number;
	};
}

function compile(): SingleUnit {
	const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
	const path = join(tmpdir(), `crust-single-${hash}.c`);
	if (!existsSync(path)) writeFileSync(path, source);
	return cc({
		source: path,
		flags: ["-framework", "AppKit", "-framework", "Foundation"],
		// `long` is 64-bit on arm64, and an i32 status is all that comes back.
		symbols: { shim_single_activate: { args: [FFIType.i64], returns: FFIType.i32 } },
	}) as unknown as SingleUnit;
}

let unitOnce: SingleUnit | undefined;

/** Compile the unit at most once per process; `cc()` costs 3–20 ms. */
export function singleUnit(): SingleUnit {
	if (process.platform !== "darwin") {
		throw new Error(`crust: single-instance activation is macOS only, not ${process.platform}`);
	}
	return (unitOnce ??= compile());
}

/** Reason for a status, including one this build does not know. */
export function activateReason(status: number, pid: number): string {
	return REASONS[status] ?? `unknown status ${status} while activating pid ${pid}`;
}

export function darwinSingleInstanceAdapter(): SingleInstanceAdapter {
	return {
		activate(pid: number): ActivatePost {
			const status = Number(
				singleUnit().symbols.shim_single_activate(pid) ?? SINGLE_STATUS.missing,
			);
			return { status, reason: activateReason(status, pid) };
		},
	};
}
