/**
 * Mode 4 of the Windows probe: **the positive control for the frame rule.**
 *
 * `36_probe.c` exports `shim_frame_probe_small`, a 2048-byte local — a 2080-byte frame, below the
 * threshold where TinyCC's PE code generator switches prologue. Bun pins `oven-sh/tinycc@05f0faf`, and
 * the PE branch of `x86_64-gen.c` emits `mov v, eax; call __chkstk` once `v >= 4096`, where `v` is the
 * locals plus the 32-byte `func_scratch`. Nothing in this unit's link set defines `__chkstk`, so the
 * call lands in a relocation filled with `-1`. Measured on `windows-latest` (2026-11-16): the 4096-byte
 * twin printed `stage frame_probe_large …` and the child ended with exit 3.
 *
 * So this mode proves the mechanism is measurable on the machine in front of you — `ok 1` means a
 * 2080-byte frame runs, and the same probe one size up does not. `src/platform/windows/frame.test.ts`
 * is what stops a frame ever reaching 4096 again, so nothing here has to be trusted to memory.
 *
 * Its own child, after modes 1-3, and its exit code is reported beside theirs rather than folded into
 * them: a prologue fault is a different defect from a `Navigate` fault.
 *
 * `cc()` is called here with one symbol instead of through `compile()`, because `ffi.ts` declares the
 * product symbol table and this is a measurement, not a symbol the platform calls.
 */
import { cc, FFIType } from "bun:ffi";
import { shimPath } from "../../src/platform/windows/ffi.ts";
import { stage } from "./report.ts";

interface FrameLibrary {
	symbols: {
		shim_frame_probe_small: () => number;
	};
}

function firstLine(error: unknown): string {
	const text = error instanceof Error ? error.message : String(error);
	return text.split("\n")[0] ?? text;
}

/** The 2080-byte frame. A `0` or a build failure is as much an answer as `1`. */
export function frameSteps(): number {
	console.log("stage     === frame mode 4 (a 2080-byte frame, the positive control) ===");
	let library: FrameLibrary;
	try {
		library = cc({
			source: shimPath(),
			symbols: {
				shim_frame_probe_small: { args: [], returns: FFIType.i32 },
			},
		}) as unknown as FrameLibrary;
	} catch (error) {
		console.log(`stage     frame_probe build failed: ${firstLine(error)}`);
		return 1;
	}
	const value = stage("frame_probe_small", () => library.symbols.shim_frame_probe_small());
	console.log(`stage     ${value === 1 ? 0 : 1} frame probe(s) did not answer`);
	return value === 1 ? 0 : 1;
}
