/**
 * The title-bar X on Windows. `WM_DESTROY` lives in C and cannot run here, so the logic is proved two
 * ways: a source scan of the two C parts (the same seam `shim-resources.test.ts` uses), and a small
 * fake shim that models the controller table with the same primitives the C calls.
 */
import { describe, expect, test } from "bun:test";
import { readShimSource } from "./shim-source.ts";

const source = readShimSource();

/** From a signature to its closing brace at column zero. */
function body(signature: string): string {
	const start = source.indexOf(signature);
	expect(start).toBeGreaterThan(-1);
	const rest = source.slice(start);
	return rest.slice(0, rest.indexOf("\n}"));
}

/** The WM_DESTROY arm of the window procedure. */
function destroyArm(): string {
	const proc = source.slice(source.indexOf("shim_i64 shim_wndproc("));
	const start = proc.indexOf("if (msg == SHIM_WM_DESTROY) {");
	expect(start).toBeGreaterThan(-1);
	return proc.slice(start, proc.indexOf("\n\t}", start));
}

describe("a title-bar close hands the controller slot back", () => {
	test("WM_DESTROY calls shim_webview_close before any quit decision", () => {
		const arm = destroyArm();
		expect(arm).toContain("shim_webview_close(hwnd)");
		expect(arm.indexOf("shim_webview_close")).toBeLessThan(arm.indexOf("shim_webview_live"));
	});

	test("the quit is gated on no tracked window remaining, never unconditional", () => {
		const arm = destroyArm();
		expect(arm).toContain("if (shim_webview_live() == 0) PostQuitMessage(0);");
		// The old arms posted this on every destroy, which ended the app on the first of three closes.
		expect(arm).not.toContain("\n\t\tPostQuitMessage(0);\n");
	});

	test("42_webview.c exposes the live count and still compacts the table on close", () => {
		expect(source).toContain("int shim_webview_live(void) { return g_windows; }");
		const close = body("void shim_webview_close(shim_h hwnd) {");
		expect(close).toContain("wv2_controller_close(g_ctrl[i])");
		expect(close).toContain("g_windows--");
		expect(close).toContain("g_ctrl[g_windows] = 0");
	});

	test("both functions are declared before the procedure that calls them", () => {
		const closeDecl = source.indexOf("void shim_webview_close(shim_h hwnd);");
		const liveDecl = source.indexOf("int shim_webview_live(void);");
		const proc = source.indexOf("shim_i64 shim_wndproc(");
		expect(closeDecl).toBeGreaterThan(-1);
		expect(liveDecl).toBeGreaterThan(-1);
		expect(closeDecl).toBeLessThan(proc);
		expect(liveDecl).toBeLessThan(proc);
	});
});

/**
 * A fake of the controller table with the same eight slots and the same two primitives the C uses:
 * `close` releases a slot, `destroy` is the WM_DESTROY arm (release, then quit if none remain).
 */
function fakeWindowTable(max = 8) {
	let slots = 0;
	let quits = 0;
	const fake = {
		bind(): boolean {
			if (slots >= max) return false;
			slots++;
			return true;
		},
		close(): void {
			if (slots > 0) slots--;
		},
		destroy(): void {
			// Mirrors the fixed WM_DESTROY: release the slot, then quit only when none remain.
			fake.close();
			if (slots === 0) quits++;
		},
		quits: (): number => quits,
		slots: (): number => slots,
	};
	return fake;
}

describe("window-close behaviour on the fake shim", () => {
	test("closing one of two windows posts no quit; closing both posts one", () => {
		const shim = fakeWindowTable();
		expect(shim.bind()).toBe(true);
		expect(shim.bind()).toBe(true);
		shim.destroy();
		expect(shim.quits()).toBe(0);
		shim.destroy();
		expect(shim.quits()).toBe(1);
	});

	test("eight closes leave every slot free, so a ninth create still binds", () => {
		const shim = fakeWindowTable();
		for (let i = 0; i < 8; i++) {
			expect(shim.bind()).toBe(true);
			shim.destroy();
		}
		expect(shim.slots()).toBe(0);
		expect(shim.bind()).toBe(true);
	});
});
