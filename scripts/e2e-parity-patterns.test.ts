/**
 * A parity proof line must name an exercised surface. "Read unavailable" and "seam
 * unavailable" explain why a surface could not run — they are never passing evidence.
 */
import { expect, test } from "bun:test";
import { MENU, SHORTCUT } from "./e2e-parity-patterns.ts";

test("menu needs a real readback that names the probe item", () => {
	expect(MENU.test('menu      titles: ["Parity probe",["Probe item"]]')).toBe(true);
	expect(MENU.test("menu      read unavailable — menu.read is not in this tree yet")).toBe(false);
	expect(MENU.test('menu      read refused: {"ok":false}')).toBe(false);
});

test("shortcut needs an emitted chord, not an unfirable seam", () => {
	expect(SHORTCUT.test("shortcut  emitted: command+shift+k")).toBe(true);
	expect(
		SHORTCUT.test("shortcut  seam unavailable — registered, but nothing can fire it here"),
	).toBe(false);
	expect(SHORTCUT.test("shortcut  register refused: bad-accelerator")).toBe(false);
});
