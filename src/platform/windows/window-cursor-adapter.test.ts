/**
 * The pointer on Windows. No platform and no window: both commands are process-wide, so the adapter
 * takes the shim directly — which is also what makes them provable on a machine with no user32.
 *
 * The two facts worth pinning are the ones the first pass refused over: `setCursor` fails when
 * `LoadCursorW` answers nothing, and `setCursorVisible` compares the count `ShowCursor` answered with
 * the side that was asked for instead of assuming a boolean round-trips.
 */
import { describe, expect, test } from "bun:test";
import { WindowAdapterError } from "@/plugins/window";
import type { WindowsShim } from "./backend.ts";
import { fakeBackend } from "./fake-backend.ts";
import { windowsCursorAdapter } from "./window-cursor-adapter.ts";

function adapter(options: Parameters<typeof fakeBackend>[0] = {}): {
	calls: string[];
	native: ReturnType<typeof windowsCursorAdapter>;
} {
	const backend = fakeBackend(options);
	const shim = backend.load();
	return { calls: backend.calls, native: windowsCursorAdapter(() => shim) };
}

function codeOf(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		if (error instanceof WindowAdapterError) return error.code;
		throw error;
	}
	throw new Error("the adapter did not throw");
}

describe("setCursor", () => {
	test("maps each name to the number the shim turns into an IDC constant", () => {
		const { calls, native } = adapter();
		for (const cursor of ["default", "pointer", "crosshair", "text", "grab"] as const) {
			native.setCursor?.(cursor);
		}
		expect(calls.filter((call) => call.startsWith("cursor:"))).toEqual([
			"cursor:0",
			"cursor:1",
			"cursor:2",
			"cursor:3",
			"cursor:4",
		]);
	});

	test("a LoadCursorW that answered nothing is a named failure", () => {
		const { native } = adapter({ failCursor: true });
		expect(codeOf(() => native.setCursor?.("pointer"))).toBe("handler-error");
	});

	test("no shim is a refusal, never a null call", () => {
		const native = windowsCursorAdapter(() => undefined);
		expect(codeOf(() => native.setCursor?.("default"))).toBe("handler-error");
	});
});

describe("setCursorVisible", () => {
	/**
	 * `ShowCursor` counts: >= 0 is visible. The fake answers the count a real call would, so a hide
	 * after a hide is the second call's count and not a boolean the adapter made up.
	 */
	test("reads the count back rather than trusting the flag", () => {
		const { calls, native } = adapter();
		native.setCursorVisible?.(false);
		native.setCursorVisible?.(true);
		expect(calls.filter((call) => call.startsWith("cursor_show:"))).toEqual([
			"cursor_show:0",
			"cursor_show:1",
		]);
	});

	test("a count on the wrong side is a named failure", () => {
		const { native } = adapter({ failCursor: true });
		expect(codeOf(() => native.setCursorVisible?.(true))).toBe("handler-error");
		expect(codeOf(() => native.setCursorVisible?.(false))).toBe("handler-error");
	});

	test("no shim is a refusal", () => {
		const native = windowsCursorAdapter(() => undefined);
		expect(codeOf(() => native.setCursorVisible?.(true))).toBe("handler-error");
	});
});

/** The shim type is what the adapter takes, so a table missing a member cannot compile there. */
test("the fake table is a WindowsShim", () => {
	const shim: WindowsShim = fakeBackend().load();
	expect(shim.shim_cursor_show(1)).toBeNumber();
});
