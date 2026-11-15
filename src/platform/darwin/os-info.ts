/**
 * macOS system information: `NSProcessInfo` for the OS product version, `NSLocale` for the preferred language, `NSBundle` for the app's own version. It reads the same C unit as the opener — one compile, two halves — and imports no plugin, so the direction of the dependency is platform → nothing.
 * Every value here is what the system reported: the version parses `-operatingSystemVersionString` (measured equal to `sw_vers -productVersion`), and an unreadable one throws so the plugin answers a typed failure instead of a `-1.-1.-1`.
 */

import { unit } from "./opener.ts";

export interface OsFactsSource {
	/** The OS product version, e.g. `"27.0.1"`. */
	systemVersion(): string;
	/** The user's preferred language identifier, e.g. `"en-GB"`. */
	locale(): string;
	/** `CFBundleShortVersionString`, or null when the process carries no bundle. */
	appVersion(): string | null;
}

/** The native half of `crust:os`; `createOsPlugin` accepts it structurally. */
export function darwinOsAdapter(): OsFactsSource {
	return {
		systemVersion: () => {
			const symbols = unit().symbols;
			const parts = [0, 1, 2].map((component) =>
				Number(symbols.crust_os_version(component) ?? -1),
			);
			if ((parts[0] ?? -1) < 0) {
				throw new Error("NSProcessInfo did not report an operating system version");
			}
			return parts.join(".");
		},
		locale: () => String(unit().symbols.crust_os_locale() ?? ""),
		appVersion: () => {
			const version = String(unit().symbols.crust_os_app_version() ?? "");
			return version.length > 0 ? version : null;
		},
	};
}
