/**
 * The live status-item adapter, driven against the real compiled AppKit unit —
 * no fake can prove the one-live-bar rule, the destroyed guards, the title
 * readback or the click trampoline, because those live in this module's state.
 * No mouse is moved: `activateRow` sends the row's target/action programmatically.
 * Every test destroys its bar, so none leaks into the plugin suite or the next test.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createStatusBar, currentStatusBar } from "./status-bar-item.ts";

afterEach(() => {
	currentStatusBar()?.destroy();
});

describe("createStatusBar — one live bar per process", () => {
	test("a second create throws while one is live, and destroy frees the slot", () => {
		const bar = createStatusBar();
		expect(currentStatusBar()).toBe(bar);
		expect(() => createStatusBar()).toThrow(/one status bar per process/);
		bar.destroy();
		expect(currentStatusBar()).toBeUndefined();
		expect(createStatusBar()).toBeDefined();
	});

	test("destroy is idempotent and keeps the slot free", () => {
		const bar = createStatusBar();
		bar.destroy();
		expect(() => bar.destroy()).not.toThrow();
		expect(currentStatusBar()).toBeUndefined();
		expect(createStatusBar()).toBeDefined();
	});
});

describe("a live status bar", () => {
	test("applies a title and reads it back from AppKit", () => {
		const bar = createStatusBar();
		bar.setTitle("crust-title-probe");
		expect(bar.readback().title).toBe("crust-title-probe");
		bar.setTitle("");
		expect(bar.readback().title).toBe("");
	});

	test("a title past the bounded readback buffer is applied without a false failure", () => {
		const bar = createStatusBar();
		// The 512-byte C buffer cannot hold 600 bytes, so the adapter must skip
		// the compare rather than report a truncation as a wrong title.
		expect(() => bar.setTitle("x".repeat(600))).not.toThrow();
	});

	test("show and hide drive the visibility AppKit reports", () => {
		const bar = createStatusBar();
		bar.show();
		expect(bar.readback().visible).toBe(true);
		bar.hide();
		expect(bar.readback().visible).toBe(false);
		bar.show();
		expect(bar.readback().visible).toBe(true);
	});

	test("a click routes to the row's handler through the trampoline", () => {
		const bar = createStatusBar();
		const hits: string[] = [];
		bar.setMenu([
			{ label: "First", onClick: () => hits.push("first") },
			{ label: "Second", onClick: () => hits.push("second") },
		]);
		expect(bar.activateRow(1)).toBe(true);
		expect(hits).toEqual(["second"]);
		expect(bar.activateRow(0)).toBe(true);
		expect(hits).toEqual(["second", "first"]);
	});

	test("a row with no handler and an out-of-range row do nothing", () => {
		const bar = createStatusBar();
		let hits = 0;
		bar.setMenu([{ label: "No handler" }, { label: "With", onClick: () => hits++ }]);
		expect(bar.activateRow(0)).toBe(true);
		expect(hits).toBe(0);
		expect(bar.activateRow(2)).toBe(false);
		expect(bar.activateRow(-1)).toBe(false);
		expect(bar.activateRow(1)).toBe(true);
		expect(hits).toBe(1);
	});

	test("setMenu copies the entries, so caller mutation cannot reroute a click", () => {
		const bar = createStatusBar();
		let hits = 0;
		const entries = [{ label: "Original", onClick: () => (hits += 1) }];
		bar.setMenu(entries);
		entries[0] = { label: "Changed", onClick: () => (hits += 100) };
		expect(bar.activateRow(0)).toBe(true);
		expect(hits).toBe(1);
	});

	test("an empty menu detaches every row", () => {
		const bar = createStatusBar();
		let hits = 0;
		bar.setMenu([{ label: "Only", onClick: () => hits++ }]);
		bar.setMenu([]);
		expect(bar.activateRow(0)).toBe(false);
		expect(hits).toBe(0);
	});

	test("rows replace in place: new handlers fire, old rows go, title reads back", () => {
		const bar = createStatusBar();
		const hits: string[] = [];
		bar.setMenu([{ label: "Old", onClick: () => hits.push("old") }]);

		// setMenu rebuilds the NSMenu on the SAME NSStatusItem — no destroy/recreate,
		// so the icon does not flicker and the click trampoline is untouched.
		bar.setMenu([
			{ label: "New A", onClick: () => hits.push("new-a") },
			{ label: "New B", onClick: () => hits.push("new-b") },
		]);
		expect(currentStatusBar()).toBe(bar);

		// Two rows now: the old single row is gone, and each new handler still fires.
		expect(bar.activateRow(0)).toBe(true);
		expect(bar.activateRow(1)).toBe(true);
		expect(bar.activateRow(2)).toBe(false);
		expect(hits).toEqual(["new-a", "new-b"]);

		// A title set after the swap reads back from AppKit on the same item.
		bar.setTitle("after-row-swap");
		expect(bar.readback().title).toBe("after-row-swap");
	});
});

describe("a destroyed status bar", () => {
	test("every method needing a live item throws instead of crossing into AppKit", () => {
		const bar = createStatusBar();
		bar.destroy();
		const guard = /was destroyed/;
		expect(() => bar.setTitle("x")).toThrow(guard);
		expect(() => bar.show()).toThrow(guard);
		expect(() => bar.hide()).toThrow(guard);
		expect(() => bar.setMenu([])).toThrow(guard);
		expect(() => bar.activateRow(0)).toThrow(guard);
		expect(() => bar.readback()).toThrow(guard);
	});
});
