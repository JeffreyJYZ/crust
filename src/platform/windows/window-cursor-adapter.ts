/**
 * The pointer on Windows: `crust:window`'s `setCursor` and `setCursorVisible`. Split from
 * `window-adapter.ts` because both are process-wide — macOS has one cursor per app, and Win32's
 * `SetCursor` and `ShowCursor` are the thread's — so neither takes a label and neither can go through
 * the adapter's own `require`.
 *
 * **The shape's proof is `LoadCursorW`.** It answers a handle or null, so a refused constant is a 0
 * from the shim rather than a cursor that silently did not change.
 *
 * **`setCursorVisible` is a count, not a boolean.** `ShowCursor` increments or decrements and answers
 * the new count, and the pointer is visible while the count is `>= 0`. The shim drives the count to
 * the side asked for and answers it; this adapter compares the sign with the request, so a call that
 * did not get there is a named failure rather than a claim.
 *
 * The window procedure re-applies the shape on every `WM_SETCURSOR` — without that the next mouse move
 * would reset it to the class arrow, which is why the first pass refused this member instead of
 * shipping a no-op.
 */
import { WindowAdapterError, type WindowChromeNative, type WindowCursor } from "@/plugins/window";
import type { WindowsShim } from "./backend.ts";

/** The five names, as the numbers `49_cursor.c` maps to `IDC_*` constants. */
const KINDS: Record<WindowCursor, number> = {
	default: 0,
	pointer: 1,
	crosshair: 2,
	text: 3,
	grab: 4,
};

export function windowsCursorAdapter(
	shim: () => WindowsShim | undefined,
): Pick<WindowChromeNative, "setCursor" | "setCursorVisible"> {
	const table = (): WindowsShim => {
		const current = shim();
		if (current === undefined) {
			throw new WindowAdapterError(
				"handler-error",
				"crust: the Windows shim is not loaded — the pointer needs a started platform",
			);
		}
		return current;
	};

	return {
		setCursor(cursor: WindowCursor): void {
			if (Number(table().shim_cursor_set(KINDS[cursor])) === 1) return;
			throw new WindowAdapterError(
				"handler-error",
				`crust: the pointer did not change to ${JSON.stringify(cursor)} ` +
					"(LoadCursorW or SetCursor failed)",
			);
		},
		setCursorVisible(visible: boolean): void {
			const count = Number(table().shim_cursor_show(visible ? 1 : 0));
			// `>= 0` is visible, which is ShowCursor's own rule; a mismatch means the count is on the
			// wrong side, so the pointer is not in the state that was asked for.
			if (count >= 0 === visible) return;
			throw new WindowAdapterError(
				"handler-error",
				`crust: the pointer was asked to be ${visible ? "visible" : "hidden"} but ` +
					`ShowCursor counted ${count}`,
			);
		},
	};
}
