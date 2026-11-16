/**
 * macOS appearance: what the app draws in, and the override a page can ask for, through the unit in `shim/103_theme.c`. Its own translation unit because `NSApplication` already exists by the time a page asks, and it imports no plugin — `crust:theme` takes the adapter structurally.
 * The override is `-[NSApplication setAppearance:]` with `+[NSAppearance appearanceNamed:]`; `"system"` sends nil, which hands the choice back to macOS. The effective appearance is read back afterwards, so a caller learns what the app actually shows rather than what it asked for.
 */

import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A compiled binary has no readable `import.meta.dir`, so the C unit travels inside the binary as
// text and is materialised before `cc()` sees it — the device `opener.ts` uses.
import themePart from "./shim/103_theme.c" with { type: "text" };

/** The unit as C source, byte-exact as one file. */
export const themeSource = themePart;

/** The exports, as `bun:ffi` hands them back. */
export interface ThemeUnit {
	symbols: {
		crust_theme_current: () => number;
		crust_theme_set: (appearance: number) => number;
		crust_theme_reason: () => string | null;
	};
}

function compile(): ThemeUnit {
	/** Content-hashed, so a second launch reuses the file and TinyCC's cache. */
	function sourcePath(): string {
		const hash = createHash("sha256").update(themeSource).digest("hex").slice(0, 16);
		const file = join(tmpdir(), `crust-theme-${hash}.c`);
		if (!existsSync(file)) writeFileSync(file, themeSource);
		return file;
	}

	return cc({
		source: sourcePath(),
		flags: ["-framework", "AppKit", "-framework", "Foundation", "-framework", "CoreFoundation"],
		symbols: {
			crust_theme_current: { args: [], returns: FFIType.i32 },
			crust_theme_set: { args: [FFIType.i32], returns: FFIType.i32 },
			crust_theme_reason: { args: [], returns: FFIType.cstring },
		},
	}) as unknown as ThemeUnit;
}

let unitOnce: ThemeUnit | undefined;

/** Compile at most once per process; `cc()` costs 3–30 ms. */
export function themeUnit(): ThemeUnit {
	return (unitOnce ??= compile());
}

export type DarwinAppearance = "light" | "dark";
export type DarwinAppearancePreference = DarwinAppearance | "system";

/** The native half as this module hands it out; `crust:theme` takes it structurally. */
export interface DarwinThemeAdapter {
	/** The appearance the app is drawing in right now, override included. */
	current(): DarwinAppearance;
	/** `"system"` clears the override, so macOS decides again. */
	set(appearance: DarwinAppearancePreference): void;
}

/** The C codes: 0 Aqua, 1 DarkAqua, 2 nil. */
const CODES: Record<DarwinAppearancePreference, number> = { light: 0, dark: 1, system: 2 };

/**
 * The native half of `crust:theme`. A refusal carries the C reason, which names the step that said no,
 * so a failed override is never reported as a page that simply stayed light.
 */
export function darwinThemeAdapter(): DarwinThemeAdapter {
	return {
		current: () => {
			const code = Number(themeUnit().symbols.crust_theme_current() ?? -1);
			if (code === 0) return "light";
			if (code === 1) return "dark";
			throw new Error("NSApplication did not report an effective appearance");
		},
		set: (appearance) => {
			const unit = themeUnit();
			if (Number(unit.symbols.crust_theme_set(CODES[appearance]) ?? 0) !== 1) {
				const reason = String(unit.symbols.crust_theme_reason() ?? "");
				throw new Error(
					reason.length > 0
						? `NSApplication refused the appearance: ${reason}`
						: `NSApplication refused the appearance with no recorded reason`,
				);
			}
		},
	};
}
