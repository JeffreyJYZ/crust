/**
 * The Linux platform this process built, so the plugin registry can find its window adapter.
 *
 * `nativePlugins` picks the window adapter by OS, but `runtime.ts` hands it only the *darwin*
 * platform — that is the type the darwin arm reads — so a Linux adapter has no argument to arrive
 * through. The instance registers itself here from `createPlatform`, and the registry asks by name:
 * the same shape `src/platform/windows/active-platform.ts` uses, and the alternative would be a cast
 * on `loadPlatform`'s `Platform` return to reach `nativeWindow`.
 *
 * `native` is the shim table the adapter is built on. Production leaves it unset and the adapter
 * resolves `shim()` itself; a test drives a fake platform on a machine with no GTK, so it registers
 * the fake table beside it. One process, one platform.
 */
import type { LinuxPlatform } from "./platform.ts";
import type { LinuxShim } from "./shim-ffi.ts";

/** What the registry needs to build the window adapter: the platform, and the table to build it on. */
export interface LinuxWindowWiring {
	platform: LinuxPlatform;
	native?: LinuxShim;
}

let active: LinuxWindowWiring | undefined;

/** Called by `createPlatform`; `undefined` clears it, which is what a test's teardown wants. */
export function setActiveLinuxPlatform(wiring: LinuxWindowWiring | undefined): void {
	active = wiring;
}

/** The Linux platform this process is running, or `undefined` before `createPlatform`. */
export function activeLinuxPlatform(): LinuxWindowWiring | undefined {
	return active;
}
