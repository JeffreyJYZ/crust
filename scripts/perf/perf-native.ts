/** Native table for the perf scaffold. The C unit is perf-native.c beside this file. */
import { cc, FFIType } from "bun:ffi";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import source from "./perf-native.c" with { type: "text" };

const P = FFIType.ptr;
const I32 = FFIType.i32;
const I64 = FFIType.i64;

export interface PerfNative {
	perf_has_sel: (obj: number, name: string) => number;
	perf_occlusion: (web: number, enabled: number) => number;
	perf_occlusion_state: (win: number) => bigint;
	perf_keep_awake: () => number;
}

let table: PerfNative | undefined;

export function perfNative(): PerfNative {
	if (table) return table;
	const path = join(mkdtempSync(join(tmpdir(), "crust-perf-")), "perf.c");
	writeFileSync(path, source);
	table = cc({
		source: path,
		flags: ["-framework", "AppKit", "-framework", "Foundation", "-framework", "WebKit"],
		symbols: {
			perf_has_sel: { args: [P, P], returns: I32 },
			perf_occlusion: { args: [P, I32], returns: I32 },
			perf_occlusion_state: { args: [P], returns: I64 },
			perf_keep_awake: { args: [], returns: I32 },
		},
	}).symbols as unknown as PerfNative;
	return table;
}
