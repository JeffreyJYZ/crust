/**
 * Closing one Win32 window. The controller goes first, then the window; Win32 reuses a freed
 * handle, so a second destroy on the same hwnd would fault. Dropping the label is left to the
 * registry's liveness read — `shim_window_destroy` makes `IsWindow` answer 0, so the next `get`
 * or `labels()` prunes it without a second map.
 */
import type { WindowsShim } from "./backend.ts";
import type { WindowsRegistry } from "./windows-registry.ts";

/** Close one tracked window by label. Unknown labels and a platform that never started are no-ops. */
export function destroyWindow(
	registry: WindowsRegistry,
	shim: WindowsShim | undefined,
	label: string,
): void {
	const entry = registry.get(label);
	if (!entry || !shim) return;
	shim.shim_webview_close(entry.hwnd);
	shim.shim_window_destroy(entry.hwnd);
}
