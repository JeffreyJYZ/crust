/**
 * What this platform needs from the machine, in two halves that fail differently, and the asymmetry is the confusing part. GTK3 and WebKitGTK are asked of the runtime — `dlopen` plus one symbol — so they answer about what loads at launch and need no `-dev` package: the shim reaches both through `dlopen`. libc is the one library the shim actually links, so `cc()` needs the `libc.so` linker script, which only the C development package ships — the runtime package carries `libc.so.6` and no script. TinyCC answers `library c not found` when it is absent, and `linkError` turns that into the install line.
 * `preflightError` returns a string and never throws, the same contract as the darwin one, because a missing library must name itself instead of ending in a stack trace.
 */
import { dlopen, FFIType } from "bun:ffi";

/** One library the shim cannot start without, and the symbol that proves it loaded. */
export interface PreflightEntry {
	/** Soname, as `dlopen` names it — the runtime object, never the linker alias. */
	library: string;
	/** One entry point the shim resolves at launch; its absence is the same failure. */
	symbol: string;
	/** The Debian package that provides it, for the install line. */
	pkg: string;
}

export const PREFLIGHT: readonly PreflightEntry[] = [
	{ library: "libgtk-3.so.0", symbol: "gtk_init_check", pkg: "libgtk-3-0" },
	{
		library: "libwebkit2gtk-4.1.so.0",
		symbol: "webkit_web_view_new",
		pkg: "libwebkit2gtk-4.1-0",
	},
];

/** The one line a person needs when a probe fails, on both families crust documents. */
export const INSTALL_LINE =
	"Debian/Ubuntu: sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0 · Fedora: sudo dnf install gtk3 webkit2gtk4.1";

/**
 * The C development package, which owns the `libc.so` linker script TinyCC needs. It is named
 * apart from `INSTALL_LINE` because it is not a runtime library: nothing `dlopen`s it, and a
 * machine can have GTK and WebKitGTK and still fail to compile the shim.
 */
export const LIBC_PKG = "glibc-devel";

/** The same install line for the compiler-level dependency, per family. */
export const LIBC_INSTALL_LINE =
	"Debian/Ubuntu: sudo apt install libc6-dev · Fedora: sudo dnf install glibc-devel · openSUSE: sudo zypper install glibc-devel";

/**
 * TinyCC's own wording when `-lc` cannot be resolved: `library c not found` from `cc()`, and the
 * `-lc` form from a direct tcc call. Both mean the linker script is missing, never that the
 * runtime library is.
 */
const LIBC_LINK_FAILURES: readonly RegExp[] = [
	/librar(?:y|ies)\s+'?c'?\s+not\s+found/i,
	/unable to find library -lc/i,
];

/**
 * Translate a compile failure that is really a missing linker script. Returns `undefined` for any
 * other error, so a genuine C mistake keeps its own text rather than being reported as a package.
 */
export function linkError(detail: string): string | undefined {
	if (!LIBC_LINK_FAILURES.some((pattern) => pattern.test(detail))) return undefined;
	return [
		`the C shim could not link libc — TinyCC answered "${detail.trim()}", so the libc.so linker script is missing`,
		`  install ${LIBC_PKG} — the C development package, not the runtime one (libc6-dev on Debian/Ubuntu)`,
		`  ${LIBC_INSTALL_LINE}`,
		"  GTK3 and WebKitGTK need no -devel package: the shim reaches both through dlopen, so libc is the only thing it links",
	].join("\n");
}

/** A probe answers whether a library and its symbol are loadable; injected so tests never touch GTK. */
export type LibraryProbe = (entry: PreflightEntry) => boolean;

/**
 * The real probe. `dlopen` with one symbol both loads the library and resolves
 * that entry point, and it throws on either failure — the throw is caught here
 * so the caller only ever sees a boolean.
 */
export function dlopenProbe(entry: PreflightEntry): boolean {
	try {
		const library = dlopen(entry.library, {
			[entry.symbol]: { args: [], returns: FFIType.void },
		});
		library.close();
		return true;
	} catch {
		return false;
	}
}

/** Resolve one entry against the runtime. Returns an error string, never throws. */
export function preflightError(
	entry: PreflightEntry,
	probe: LibraryProbe = dlopenProbe,
): string | undefined {
	let present = false;
	try {
		present = probe(entry);
	} catch {
		present = false;
	}
	if (present) return undefined;
	return `${entry.library} not loadable (${entry.symbol} unresolved) — install ${entry.pkg}\n  ${INSTALL_LINE}`;
}

/** Every entry that failed, in `PREFLIGHT` order; empty means the runtime is complete. */
export function preflightErrors(probe: LibraryProbe = dlopenProbe): string[] {
	const errors: string[] = [];
	for (const entry of PREFLIGHT) {
		const error = preflightError(entry, probe);
		if (error) errors.push(error);
	}
	return errors;
}
