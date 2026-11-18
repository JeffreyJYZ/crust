/**
 * The shim a Windows platform compiled, and the one sentence every adapter says when there is none.
 *
 * The registry builds its plugins before a platform necessarily exists, so the adapter cannot hold
 * the shim at construction: it asks per call, the same shape `windowsWindowAdapter` uses. `undefined`
 * is the honest answer for a Linux launch or a macOS test, where no Win32 symbol can exist at all.
 */
import { activeWindowsPlatform } from "./active-platform.ts";
import type { WindowsShim } from "./backend.ts";

/** The shim this process's Windows platform compiled, or `undefined` before `start()`. */
export function activeWindowsShim(): WindowsShim | undefined {
	return activeWindowsPlatform()?.shim();
}

/** What every Win32-backed command answers when no platform has started one. */
export const NO_WINDOWS_SHIM =
	"crust: no Windows platform is attached, so the Win32 shim is not loaded — this command answers only after app.run() has started one";

/** The shim, or a throw carrying {@link NO_WINDOWS_SHIM}. */
export function requireWindowsShim(
	native: () => WindowsShim | undefined = activeWindowsShim,
): WindowsShim {
	const shim = native();
	if (shim === undefined) throw new Error(NO_WINDOWS_SHIM);
	return shim;
}
