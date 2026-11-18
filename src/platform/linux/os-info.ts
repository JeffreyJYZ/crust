/**
 * `crust:os.info` on Linux: the product version from `/etc/os-release`, the locale from GLib's
 * `g_get_language_names`, and the time since boot from `node:os`. Nothing is invented — the file is
 * what the distribution writes, the language list is what GLib resolved for this user, and the
 * kernel's own release is the fallback when the file is unreadable.
 *
 * **Not a macOS-shaped answer.** `os-release` has no single "version" field every distribution fills
 * the same way, so `VERSION_ID` wins (it is the machine-comparable one), `PRETTY_NAME` is the
 * fallback a human can read, and the kernel release is the last resort — each named in the code
 * rather than guessed.
 *
 * UNPROVEN ON REAL GTK: the locale half was written on macOS, where libgtk-3.so.0 does not exist. The
 * tests drive it through a fake symbol table and a real fixture file, so the parsing and the
 * normalisation are proved, not GLib.
 */
import { readFileSync } from "node:fs";
import { release, uptime } from "node:os";
import type { OsAdapter } from "@/plugins/os";
import { type LinuxShim, shim } from "./shim-ffi.ts";

/** The file every distribution writes; `os-release(5)` names this path as the one to read. */
export const OS_RELEASE = "/etc/os-release";

/**
 * `VERSION_ID`, then `PRETTY_NAME`, out of the `KEY=value` lines. Quotes are stripped because
 * `PRETTY_NAME` is always quoted and a version a page displays should not carry them.
 */
export function parseOsRelease(text: string): string | undefined {
	const fields = new Map<string, string>();
	for (const line of text.split("\n")) {
		const at = line.indexOf("=");
		if (at <= 0) continue;
		const key = line.slice(0, at).trim();
		const value = line
			.slice(at + 1)
			.trim()
			.replace(/^"(.*)"$/, "$1");
		if (key.length > 0) fields.set(key, value);
	}
	const version = fields.get("VERSION_ID");
	if (version !== undefined && version.length > 0) return version;
	const pretty = fields.get("PRETTY_NAME");
	return pretty !== undefined && pretty.length > 0 ? pretty : undefined;
}

/**
 * `"en_GB.UTF-8"` → `"en-GB"`. A BCP-47 tag carries neither the codeset nor an `@modifier`, so both
 * are cut, and the POSIX underscore becomes the tag's hyphen.
 */
export function bcp47(name: string): string {
	const bare = (name.split("@")[0] ?? "").split(".")[0] ?? "";
	return bare.replace(/_/g, "-");
}

/** Build the `crust:os` native half. The shim compiles on the first `locale` call, never at import. */
export function linuxOsAdapter(
	native: () => LinuxShim = () => shim().symbols,
	releasePath: string = OS_RELEASE,
): OsAdapter {
	return {
		systemVersion: () => {
			try {
				const version = parseOsRelease(readFileSync(releasePath, "utf8"));
				if (version !== undefined) return version;
			} catch {
				// An unreadable os-release is a real state on a minimal image; the kernel still knows
				// its own release, which is the OS's answer and not a guess.
			}
			return release();
		},

		locale: () => {
			const symbols = native();
			if (Number(symbols.shim_os_locale_ready?.() ?? 0) !== 1) {
				throw new Error(
					"crust: os.locale needs g_get_language_names from GLib, which libgtk-3.so.0 did not export",
				);
			}
			const tag = bcp47(String(symbols.shim_os_locale?.() ?? ""));
			if (tag.length === 0) {
				throw new Error("crust: g_get_language_names answered no language for this user");
			}
			return tag;
		},

		/** No bundle, so no bundle version: null is the honest answer, not a guess. */
		appVersion: () => null,

		uptime: () => uptime(),
	};
}
