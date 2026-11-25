/**
 * `crust:os.info` on Windows: `RtlGetVersion` for the product version, `GetUserDefaultLocaleName`
 * for the locale, `GetTickCount64` for the time since boot. Nothing is invented — the three values
 * the TypeScript half cannot read are exactly the three the shim asks Windows for, and a refusal
 * throws with the call that failed so the plugin answers `handler-error` rather than `"-1.-1.-1"`.
 *
 * **Not `GetVersionExW`.** Since Windows 8.1 the documented call answers 6.2 to a process with no
 * compatibility manifest, which is every crust app; ntdll's `RtlGetVersion` is the call that still
 * reports the real build.
 *
 * `appVersion` is `null` on purpose: a Win32 process carries no bundle, and inventing a version from
 * the executable name would be the macOS-shaped answer this adapter exists to avoid.
 *
 * UNPROVEN ON WINDOWS: written on macOS. The tests drive it through the fake shim, so the parsing
 * and the refusals are proved, not ntdll.
 */
import type { OsAdapter } from "@/plugins/os";
import { activeWindowsShim, requireWindowsShim } from "./active-shim.ts";
import type { WindowsShim } from "./backend.ts";

/** Build the `crust:os` native half. The shim is asked per call, never held at construction. */
export function windowsOsAdapter(
	native: () => WindowsShim | undefined = activeWindowsShim,
): OsAdapter {
	return {
		/** Three components of `RtlGetVersion`, joined the way Windows names a build: 10.0.22631. */
		systemVersion: () => {
			const shim = requireWindowsShim(native);
			const parts = [0, 1, 2].map((component) =>
				Number(shim.shim_os_version(component) ?? -1),
			);
			if ((parts[0] ?? -1) < 0) {
				throw new Error("crust: RtlGetVersion did not report a Windows version");
			}
			return parts.join(".");
		},

		/** The user's own locale, as the BCP-47 tag Windows already answers in ("en-GB"). */
		locale: () => {
			const shim = requireWindowsShim(native);
			const locale = String(shim.shim_os_locale() ?? "");
			if (locale.length === 0) {
				throw new Error("crust: GetUserDefaultLocaleName answered no locale");
			}
			return locale;
		},

		/** No bundle, so no bundle version: null is the honest answer, not a guess. */
		appVersion: () => null,

		/** `GetTickCount64` in seconds. Windows excludes time asleep from this counter. */
		uptime: () => {
			const shim = requireWindowsShim(native);
			const seconds = Number(shim.shim_os_uptime() ?? -1);
			// The shim names an unreadable counter with -1. A real 0 is the first second of an
			// awake session and must be reported, not mistaken for the refused reading.
			if (!(seconds >= 0)) {
				throw new Error("crust: GetTickCount64 did not report a system uptime");
			}
			return seconds;
		},
	};
}
