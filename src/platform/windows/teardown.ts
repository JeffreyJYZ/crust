/**
 * Tearing a Windows platform down: close each controller, then its window, and skip a window the
 * human already closed. Win32 reuses a freed handle, so a second Close on a stale one faults, and
 * the pump has to stop first or a queued WM_SIZE resizes a controller that no longer exists.
 */
import type { WindowsShim } from "./backend.ts";
import type { WindowsRegistry } from "./windows-registry.ts";

/** Destroy every open window and drop the registry. Returns how many were torn down. */
export function teardown(registry: WindowsRegistry, shim: WindowsShim): number {
	let closed = 0;
	for (const entry of registry.entries()) {
		if (!registry.isOpen(entry.hwnd)) continue;
		shim.shim_webview_close(entry.hwnd);
		shim.shim_window_destroy(entry.hwnd);
		closed++;
	}
	registry.clear();
	return closed;
}
