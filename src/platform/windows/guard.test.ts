/**
 * Two behaviours that are invisible until they cost a run: a vtable entry that is not code must be
 * refused rather than jumped to, and a wait must be bounded by a deadline rather than by iterations of
 * `Sleep(1)`.
 *
 * `Sleep(1)` rounds up to the ~15.6 ms timer tick on Windows, so `maxMs = 5000` read as an iteration
 * count was ~48 s — which is why one probe run took 95.5 s. And a probe that jumps to
 * `0xffffffffffffffff` reports exactly one defect, which is how seven of them each needed their own run.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lf, readShimPart, readShimSource, SHIM_PART_NAMES } from "./shim-source.ts";

const source = readShimSource();
const guard = readShimPart("14_guard.c");
const com = readShimPart("30_com.c");
const stages = lf(
	readFileSync(
		join(import.meta.dir, "..", "..", "..", "scripts", "windows", "stages.ts"),
		"utf8",
	),
);

describe("the vtable guard", () => {
	test("is its own part, before anything that calls a slot", () => {
		const guardAt = SHIM_PART_NAMES.indexOf("14_guard.c");
		expect(guardAt).toBeGreaterThan(SHIM_PART_NAMES.indexOf("12_win32.c"));
		expect(guardAt).toBeLessThan(SHIM_PART_NAMES.indexOf("20_class.c"));
	});

	/** 0, `(void *)-1` and memory that is not committed executable are three ways to jump to nowhere. */
	test("refuses a null, a -1 and a non-executable address, and records the slot", () => {
		expect(guard).toContain("if (!address || address == (const void *)-1) return 0;");
		expect(guard).toContain("(*(unsigned int *)((const char *)info + 32) & 0x1000u) == 0");
		expect(guard).toContain("(*(unsigned int *)((const char *)info + 36) & 0xF0u) == 0");
		expect(guard).toContain("g_bad_slot = index;");
		expect(source).toContain("SHIM_BIND(g_kernel32, VirtualQuery);");
	});

	test("every vtable call site checks its own slot first", () => {
		// One per call: environment slot 3, controller 25, put_Bounds 6, Close 24, Navigate 5.
		expect(source.match(/shim_slot_ok\(vt, /g)?.length).toBe(5);
		for (const slot of [
			"SHIM_SLOT_ENV_CREATE_CONTROLLER",
			"SHIM_SLOT_CONTROLLER_WEBVIEW",
			"SHIM_SLOT_CONTROLLER_PUT_BOUNDS",
			"SHIM_SLOT_CONTROLLER_CLOSE",
			"SHIM_SLOT_WEBVIEW_NAVIGATE",
		]) {
			expect(source).toContain(`if (!shim_slot_ok(vt, ${slot}))`);
		}
	});
});

describe("the wait is bounded by a deadline", () => {
	test("handler_wait measures time, not iterations", () => {
		expect(com).toContain("GetTickCount64");
		expect(com).not.toContain("int waited = 0;");
		expect(com).toContain("GetTickCount64() >= deadline");
		expect(source).toContain("SHIM_BIND(g_kernel32, GetTickCount64);");
	});
});

describe("the probe reports every defect in one run", () => {
	/** `0x802A000C` arrives zero-extended as `2150236172`, which a plain `< 0` scores as a pass. */
	test("scores an HRESULT by its low 32 bits, and prints both forms", () => {
		expect(stages).toContain("(value | 0) < 0");
		expect(stages).toContain("ok ${value} (${hex(value)})");
	});

	/** An absence has to be visible: a skipped stage prints why, rather than vanishing. */
	test("prints why the rest of the run is missing", () => {
		expect(stages).toContain("function skipped(");
		expect(stages).toMatch(/skipped\("no window/);
		expect(stages).toMatch(/skipped\("no controller/);
		expect(stages).toMatch(/skipped\("no ICoreWebView2/);
	});
});
