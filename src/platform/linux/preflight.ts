/**
 * What this platform needs from the machine, asked of the runtime rather than the SDK: each library is probed with `dlopen` and one symbol, so the answer is about what will load at launch and not about whether a `-dev` package happens to be installed. `preflightError` returns a string and never throws, the same contract as the darwin one, because a missing library must name itself instead of ending in a stack trace.
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
