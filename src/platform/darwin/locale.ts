/**
 * macOS locale: `+[NSLocale preferredLanguages]` first object, through the unit in `shim/102_locale.c`. It is its own translation unit because none of it needs a window, and it imports no plugin — the adapter is a plain object, so `crust:i18n` takes it structurally.
 * The shim's four rules apply unchanged: one fixed prototype per `objc_msgSend`, no framework header, no object and no struct across `bun:ffi`, and the answer comes back as a C string, never as an `NSString`.
 */

import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A compiled binary has no readable `import.meta.dir`, so the C unit travels inside the binary as
// text and is materialised before `cc()` sees it — the device `opener.ts` uses.
import localePart from "./shim/102_locale.c" with { type: "text" };

/** The unit as C source, byte-exact as one file. */
export const localeSource = localePart;

/** The export, as `bun:ffi` hands it back. */
export interface LocaleUnit {
	symbols: {
		crust_locale_preferred: () => string | null;
	};
}

function compile(): LocaleUnit {
	/** Content-hashed, so a second launch reuses the file and TinyCC's cache. */
	function sourcePath(): string {
		const hash = createHash("sha256").update(localeSource).digest("hex").slice(0, 16);
		const file = join(tmpdir(), `crust-locale-${hash}.c`);
		if (!existsSync(file)) writeFileSync(file, localeSource);
		return file;
	}

	return cc({
		source: sourcePath(),
		flags: ["-framework", "Foundation", "-framework", "CoreFoundation"],
		symbols: {
			crust_locale_preferred: { args: [], returns: FFIType.cstring },
		},
	}) as unknown as LocaleUnit;
}

let unitOnce: LocaleUnit | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms. */
export function localeUnit(): LocaleUnit {
	return (unitOnce ??= compile());
}

/** The native half as this module hands it out; `crust:i18n` takes it structurally. */
export interface DarwinLocaleAdapter {
	/** A BCP-47 identifier such as `"en-GB"`, as macOS resolved it for this user. */
	preferredLocale(): string;
}

/**
 * The native half of `crust:i18n`. An empty answer throws instead of reporting `""` as a language:
 * the C side writes nothing when `NSLocale` is unreachable, and a plugin that echoed that would hand a
 * page a locale no formatter accepts.
 */
export function darwinLocaleAdapter(): DarwinLocaleAdapter {
	return {
		preferredLocale: () => {
			const locale = String(localeUnit().symbols.crust_locale_preferred() ?? "").trim();
			if (locale.length === 0) {
				throw new Error("NSLocale did not report a preferred language");
			}
			return locale;
		},
	};
}
