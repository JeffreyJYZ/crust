/**
 * The accessibility unit's C boundary: `shim/106_accessibility.c` compiled by `cc()` with
 * ApplicationServices and CoreFoundation linked by name — no artifact, no header.
 * An `AXUIElement` never leaves the C unit: the walk happens there and only a count crosses, because
 * an AX element is an opaque object `bun:ffi` must never hold.
 */

import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A compiled binary has no readable `import.meta.dir`, so the C unit travels inside it as text.
import accessibilityPart from "./shim/106_accessibility.c" with { type: "text" };

export const accessibilitySource = accessibilityPart;

const I32 = FFIType.i32;
const CS = FFIType.cstring;

/** Every symbol the unit declares, so a probe can prove the whole set resolved. */
export const ACCESSIBILITY_SYMBOL_NAMES = [
	"crust_ax_abi",
	"crust_ax_reason",
	"crust_ax_trusted",
	"crust_ax_prompt",
	"crust_ax_element_count",
] as const;

/** The exports, as `bun:ffi` hands them back. */
export interface AccessibilityUnit {
	symbols: {
		crust_ax_abi: () => number;
		crust_ax_reason: () => string | null;
		crust_ax_trusted: () => number;
		crust_ax_prompt: () => number;
		crust_ax_element_count: () => number;
	};
}

/** Content-hashed, so a second launch reuses the file and TinyCC's cache. */
function sourcePath(): string {
	const hash = createHash("sha256").update(accessibilitySource).digest("hex").slice(0, 16);
	const file = join(tmpdir(), `crust-accessibility-${hash}.c`);
	if (!existsSync(file)) writeFileSync(file, accessibilitySource);
	return file;
}

function compile(): AccessibilityUnit {
	return cc({
		source: sourcePath(),
		flags: ["-framework", "ApplicationServices", "-framework", "CoreFoundation"],
		symbols: {
			crust_ax_abi: { args: [], returns: I32 },
			crust_ax_reason: { args: [], returns: CS },
			crust_ax_trusted: { args: [], returns: I32 },
			crust_ax_prompt: { args: [], returns: I32 },
			crust_ax_element_count: { args: [], returns: I32 },
		},
	}) as unknown as AccessibilityUnit;
}

let unitOnce: AccessibilityUnit | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms. */
export function accessibilityUnit(): AccessibilityUnit {
	return (unitOnce ??= compile());
}

/** Whether the unit compiled and every declared export resolved. Nothing is prompted. */
export function accessibilityUnitStatus(): { available: boolean; reason: string } {
	try {
		const compiled = accessibilityUnit();
		return Number(compiled.symbols.crust_ax_abi()) === 1
			? { available: true, reason: "compiled" }
			: { available: false, reason: "crust_ax_abi did not answer 1" };
	} catch (error) {
		return { available: false, reason: error instanceof Error ? error.message : String(error) };
	}
}
