/**
 * The page-facing half of the accessibility unit: `shim/106_accessibility_page.c` and
 * `shim/106_accessibility_focus.c`, concatenated into one unit and compiled by `cc()` with AppKit
 * and ApplicationServices linked by name — no artifact, no header.
 * Split from `accessibility-ffi.ts` because these are the calls a page makes (speak, name a window,
 * move focus) while that one is the trust probe, and one bundle for both would put a page surface
 * behind a permission read it does not need.
 * An `AXUIElement` never leaves C; only an int crosses, and every string is built and consumed here.
 */

import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A compiled binary has no readable `import.meta.dir`, so the C unit travels inside it as text.
import focusPart from "./shim/106_accessibility_focus.c" with { type: "text" };
import pagePart from "./shim/106_accessibility_page.c" with { type: "text" };
import { auditFlags, auditSource, auditSymbols } from "./shim-audit.ts";

export const accessibilityPageSource = [pagePart, focusPart].join("");
/** What cc() compiles: the same two parts with the audit prelude prepended. */
export const compiledAccessibilityPageSource = auditSource(accessibilityPageSource);

const I32 = FFIType.i32;
const P = FFIType.ptr;

/** Every symbol the page unit declares, so a probe can prove the whole set resolved. */
export const ACCESSIBILITY_PAGE_SYMBOL_NAMES = [
	"crust_ax_announce",
	"crust_ax_title",
	"crust_ax_focus",
] as const;

/** The exports, as `bun:ffi` hands them back. */
export interface AccessibilityPageUnit {
	symbols: {
		crust_ax_announce: (text: unknown, assertive: number) => number;
		crust_ax_title: (text: unknown, label: unknown) => number;
		crust_ax_focus: (label: unknown) => number;
	};
}

/** Content-hashed, so a second launch reuses the file and TinyCC's cache. */
function sourcePath(): string {
	const hash = createHash("sha256").update(compiledAccessibilityPageSource).digest("hex").slice(0, 16);
	const file = join(tmpdir(), `crust-accessibility-page-${hash}.c`);
	if (!existsSync(file)) writeFileSync(file, compiledAccessibilityPageSource);
	return file;
}

function compile(): AccessibilityPageUnit {
	return cc({
		source: sourcePath(),
		flags: ["-framework", "AppKit", "-framework", "ApplicationServices", ...auditFlags()],
		symbols: {
			...auditSymbols,
			crust_ax_announce: { args: [P, I32], returns: I32 },
			crust_ax_title: { args: [P, P], returns: I32 },
			crust_ax_focus: { args: [P], returns: I32 },
		},
	}) as unknown as AccessibilityPageUnit;
}

let unitOnce: AccessibilityPageUnit | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms. */
export function accessibilityPageUnit(): AccessibilityPageUnit {
	return (unitOnce ??= compile());
}

/** Whether the page unit compiled and every declared export resolved. Nothing is announced. */
export function accessibilityPageUnitStatus(): { available: boolean; reason: string } {
	try {
		const compiled = accessibilityPageUnit();
		for (const name of ACCESSIBILITY_PAGE_SYMBOL_NAMES) {
			if (typeof compiled.symbols[name] !== "function") {
				return { available: false, reason: `${name} did not resolve` };
			}
		}
		return { available: true, reason: "compiled" };
	} catch (error) {
		return { available: false, reason: error instanceof Error ? error.message : String(error) };
	}
}
