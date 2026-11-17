/**
 * The four NSWindow action selectors are `id sender` actions. The IMP reads x2
 * as that argument, so each objc_msgSend must carry three parameters and pass
 * an explicit nil sender — a two-parameter cast leaves x2 undefined. This is a
 * source-level check: these bodies run only on a live AppKit event thread, and
 * the bug is invisible until that IMP happens to read sender.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(import.meta.dir, "shim", "92_window_state.c"), "utf8");

/** The whole body of one `void shim_*(obj_t win)` definition, braces included. */
function body(name: string): string {
	const start = SOURCE.indexOf(`void ${name}(obj_t win)`);
	expect(start).toBeGreaterThan(-1);
	const open = SOURCE.indexOf("{", start);
	let depth = 0;
	for (let i = open; i < SOURCE.length; i++) {
		if (SOURCE[i] === "{") depth++;
		else if (SOURCE[i] === "}") {
			depth--;
			if (depth === 0) return SOURCE.slice(open, i + 1);
		}
	}
	throw new Error(`unbalanced braces in ${name}`);
}

const ACTIONS = [
	["shim_window_toggle_fullscreen", "toggleFullScreen:"],
	["shim_window_zoom", "zoom:"],
	["shim_window_miniaturize", "miniaturize:"],
	["shim_window_deminiaturize", "deminiaturize:"],
] as const;

describe("NSWindow action selectors carry an explicit sender", () => {
	for (const [name, selector] of ACTIONS) {
		test(`${selector} sends three arguments with a nil sender`, () => {
			const code = body(name);
			expect(code).toContain(`sel_registerName("${selector}")`);
			expect(code).toContain("void (*)(void *, void *, void *)");
			// A two-parameter cast is the defect; it leaves x2 undefined.
			expect(code).not.toContain("void (*)(void *, void *))objc_msgSend");
			// The sender is passed explicitly, not read from an undefined register.
			const after = code.slice(code.indexOf(`sel_registerName("${selector}")`));
			expect(after).toMatch(/,\s*0\s*\)/);
		});
	}
});
