/**
 * The Windows platform this process built, so the plugin registry can find its window adapter.
 *
 * `nativePlugins` picks the window adapter by OS, and the OS arm is chosen from `process.platform`;
 * but `runtime.ts` hands the registry only the *darwin* platform (that is the type the darwin arm
 * reads), so a Windows adapter has no argument to arrive through. The instance therefore registers
 * itself here when `createPlatform` builds it, and the registry asks by name — the same shape
 * `setBridgeToken` already uses, and the alternative is a second `createPlatform` call, which would
 * register a second window class and open a second HWND for every configured window.
 *
 * One process, one platform: `app.run()` is the only thing that starts one, and a second attach is
 * refused by `App.attach`.
 */
import type { WindowsPlatform } from "./platform.ts";

let active: WindowsPlatform | undefined;

/** Called by `createPlatform`; `undefined` clears it, which is what a test's teardown wants. */
export function setActiveWindowsPlatform(platform: WindowsPlatform | undefined): void {
	active = platform;
}

/** The Windows platform this process is running, or `undefined` before `createPlatform`. */
export function activeWindowsPlatform(): WindowsPlatform | undefined {
	return active;
}
