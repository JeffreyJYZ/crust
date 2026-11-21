/**
 * The compiled QuickLook unit, driven against the real `cc()` build and the real AppKit classes —
 * no fake can prove the runtime-built data source, the item objects, or that a file URL comes back
 * out of them, because that is what QuickLook itself asks.
 * Nothing here shows a panel: `+sharedPreviewPanel` is not touched, so no window appears, nothing
 * takes keyboard focus, and the suite can run while the human is typing. The live show/hide is
 * proved out of process with a real file, which is the only honest way to see a panel.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { ptr } from "bun:ffi";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compilePreviewUnit } from "./preview-unit.ts";
import { previewUnit, previewUnitStatus } from "./preview.ts";

const notDarwin = process.platform !== "darwin";
const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A real file on disk, since the C side copies the path it is given. */
function realFile(name: string): string {
	const dir = mkdtempSync(join(tmpdir(), "crust-preview-unit-"));
	dirs.push(dir);
	const path = join(dir, name);
	writeFileSync(path, "crust preview fixture\n");
	return path;
}

// A strong reference for the duration of one send: the C unit reads the bytes during the call.
let held: Uint8Array | undefined;

/**
 * Bytes and length for the `const char *` pair. Returned as an object, never a tuple: on Bun 1.4.5 a
 * value destructured out of a returned array arrives at a `bun:ffi` call as the wrong number —
 * measured as `set_paths` answering 0 for a path list it had just been given — while the same value
 * read off an object is passed correctly.
 */
function encoded(text: string): { address: number; length: number } {
	const bytes = new TextEncoder().encode(text);
	held = bytes;
	return { address: ptr(bytes), length: bytes.length };
}

describe("the compiled QuickLook unit", () => {
	test("the C source lives in a private dir that is removed on every path", () => {
		const leftovers = () =>
			readdirSync(tmpdir())
				.filter((name) => name.startsWith("crust-preview-"))
				.sort();
		const before = leftovers();
		try {
			compilePreviewUnit();
		} catch {
			// A machine without QuickLookUI (or a non-darwin run) refuses cc(); cleanup still applies.
		}
		expect(leftovers()).toEqual(before);
	});

	test.skipIf(notDarwin)("builds the data source over the C path array", () => {
		expect(previewUnitStatus().available).toBe(true);
		const unit = previewUnit();
		const first = realFile("one.txt");
		const second = realFile("two.txt");
		// Passed as two values read off an object, never spread: `bun:ffi` reads the call's own
		// arguments, so a spread array arrives as nothing.
		const { address, length } = encoded(`${first}\n${second}`);
		expect(Number(unit.symbols.shim_preview_set_paths(address, length))).toBe(2);
		expect(Number(unit.symbols.shim_preview_count())).toBe(2);
		expect(String(unit.symbols.shim_preview_path(1))).toBe(second);
		// The panel's own question, asked through the dynamic class: one item per path, and each
		// item answers its own file URL.
		expect(Number(unit.symbols.shim_preview_probe_count())).toBe(2);
		expect(String(unit.symbols.shim_preview_probe_item_url(0))).toBe(first);
		expect(String(unit.symbols.shim_preview_probe_item_url(1))).toBe(second);
		// Nothing is floating before a show, and no window was claimed.
		expect(Number(unit.symbols.shim_preview_visible())).toBe(0);
		expect(Number(unit.symbols.shim_preview_owner())).toBe(0);
		// An index outside the list answers nothing rather than the last path.
		expect(String(unit.symbols.shim_preview_probe_item_url(5))).toBe("");
	});

	test.skipIf(notDarwin)("an empty list is no paths, not a stale one", () => {
		const unit = previewUnit();
		const { address, length } = encoded("\n\n");
		expect(Number(unit.symbols.shim_preview_set_paths(address, length))).toBe(0);
		expect(Number(unit.symbols.shim_preview_probe_count())).toBe(0);
		expect(String(unit.symbols.shim_preview_path(0))).toBe("");
	});
});
