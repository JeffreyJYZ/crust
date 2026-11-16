/**
 * `crust:dock` native proofs. The C unit is compiled and called only on its refusal paths, so
 * nothing here badges, bounces or draws on the dock of whoever is at the machine — a test that made
 * the user's dock jump would be a defect, not a proof.
 * What is proven is the boundary: the symbol set, the two `NSRequestUserAttentionType` values, the C
 * guards, and the byte range an empty label becomes. The commands live in `dock-commands.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { bytesOf, DOCK_SYMBOL_NAMES, dockUnit, dockUnitStatus } from "@/platform/darwin/dock.ts";
import { createDockPlugin, DOCK_COMMANDS, dockPlugin } from "@/plugins/dock.ts";
import { fake } from "./dock-fake.ts";

describe("104_dock.c", () => {
	test("compiles through cc(), links AppKit and exports exactly the declared symbols", () => {
		const compiled = dockUnit();
		expect(Number(compiled.symbols.crust_dock_abi())).toBe(1);
		expect(dockUnitStatus()).toEqual({ available: true, reason: "compiled" });
		for (const name of DOCK_SYMBOL_NAMES) {
			expect(typeof (compiled.symbols as unknown as Record<string, unknown>)[name]).toBe(
				"function",
			);
		}
		expect(Object.keys(compiled.symbols).sort()).toEqual([...DOCK_SYMBOL_NAMES].sort());
	});

	test("NSCriticalRequest is 0 and NSInformationalRequest is 10", () => {
		const compiled = dockUnit();
		expect(Number(compiled.symbols.crust_dock_bounce_kind(1))).toBe(0);
		expect(Number(compiled.symbols.crust_dock_bounce_kind(0))).toBe(10);
	});

	test("the guards refuse before AppKit is touched, and say which step refused", () => {
		const compiled = dockUnit();
		expect(Number(compiled.symbols.crust_dock_set_badge(0, 5))).toBe(0);
		expect(String(compiled.symbols.crust_dock_reason())).toContain("bytes");
		// A fraction outside 0..1 is refused in C, so no indicator is ever built for it.
		expect(Number(compiled.symbols.crust_dock_set_progress(-0.5))).toBe(0);
		expect(Number(compiled.symbols.crust_dock_set_progress(1.5))).toBe(0);
		expect(String(compiled.symbols.crust_dock_reason())).toContain("fraction");
	});
});

describe("the byte range handed to C", () => {
	// Measured 2026-11-16: `ptr()` refuses a zero-length Uint8Array with "bun:ffi cannot convert
	// argument to 'ptr'", so the documented "empty label clears the badge" path threw before reaching
	// C. It goes as a null pointer with length 0, which the C half reads as an empty NSString.
	test("an empty label is a null pointer with length 0, not a ptr() throw", () => {
		expect(bytesOf("")).toEqual({ address: 0, length: 0 });
		const three = bytesOf("3");
		expect(three.length).toBe(1);
		expect(three.address).not.toBe(0);
	});
});

describe("dock plugin shape", () => {
	test("is named dock and declares exactly the four commands", () => {
		const plugin = createDockPlugin(fake().adapter);
		expect(plugin.name).toBe("dock");
		expect(Object.keys(plugin.commands).sort()).toEqual([...DOCK_COMMANDS].sort());
		expect(Object.isFrozen(plugin)).toBe(true);
	});

	test("the default export is the adapter-less one", () => {
		expect(dockPlugin.name).toBe("dock");
		expect(Object.keys(dockPlugin.commands).sort()).toEqual([...DOCK_COMMANDS].sort());
	});
});
