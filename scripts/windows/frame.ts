/**
 * Mode 4 of the Windows probe: **which frame sizes this unit may use at all.**
 *
 * Bun pins TinyCC at `oven-sh/tinycc@05f0faf`, and the PE branch of `x86_64-gen.c` picks the prologue
 * from the frame size: `v < 4096` is `push rbp; mov rbp, rsp; sub rsp, imm32`, and `v >= 4096` is
 * `mov v, eax; call __chkstk`. `36_probe.c` exports two functions that differ only in the size of one
 * local buffer, so 2080 bytes and 4128 bytes, and this runs them one after the other.
 *
 * Three outcomes, three readings:
 *
 * - `small` and `large` both answer 1 — a big frame is fine, and the claim that `__chkstk` broke the
 *   first `Navigate` is dead.
 * - `small` answers 1 and the child dies on `large` — the prologue is the fault: `call __chkstk` went
 *   somewhere that is not code, and every frame of 4096 bytes or more in this unit is a landmine.
 * - the compile itself fails naming `__chkstk` — the same mechanism, caught one step earlier.
 *
 * Its own child, after modes 1-3, and its exit code is reported beside theirs rather than folded into
 * them: a prologue fault is a different defect from a `Navigate` fault, and it must not print that
 * narrative. The `stage` line printed *before* each call is what names which one died.
 *
 * `cc()` is called here with only the two symbols instead of through `compile()`, because `ffi.ts`
 * declares the product symbol table and this is a measurement, not a symbol the platform calls.
 */
import { cc, FFIType } from "bun:ffi";
import { shimPath } from "../../src/platform/windows/ffi.ts";
import { stage } from "./report.ts";

interface FrameLibrary {
	symbols: {
		shim_frame_probe_small: () => number;
		shim_frame_probe_large: () => number;
	};
}

function firstLine(error: unknown): string {
	const text = error instanceof Error ? error.message : String(error);
	return text.split("\n")[0] ?? text;
}

/** The two probes, smallest frame first, so a working small one proves the mechanism is measurable. */
export function frameSteps(): number {
	console.log("stage     === frame mode 4 (a 2080-byte frame, then a 4128-byte one) ===");
	let library: FrameLibrary;
	try {
		library = cc({
			source: shimPath(),
			symbols: {
				shim_frame_probe_small: { args: [], returns: FFIType.i32 },
				shim_frame_probe_large: { args: [], returns: FFIType.i32 },
			},
		}) as unknown as FrameLibrary;
	} catch (error) {
		// The unit would not build. If the message names `__chkstk` that is the same answer as a fault
		// on `large`, one step earlier; anything else is a different defect.
		console.log(`stage     frame_probe build failed: ${firstLine(error)}`);
		return 1;
	}
	let failures = 0;
	if (stage("frame_probe_small", () => library.symbols.shim_frame_probe_small()) !== 1)
		failures++;
	if (stage("frame_probe_large", () => library.symbols.shim_frame_probe_large()) !== 1)
		failures++;
	console.log(`stage     ${failures} frame probe(s) did not answer`);
	return failures === 0 ? 0 : 1;
}
