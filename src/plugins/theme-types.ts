/**
 * The shape of `crust:theme`: the appearance values, the state a page is told, and the adapter a
 * platform supplies. Types only — the command surface lives in `theme.ts`, so a client can import a
 * type without pulling the plugin in.
 */

import type { NotImplemented, PluginContext, PluginDefinition } from "./define";

export type Appearance = "light" | "dark";

/** What a page can ask for: an appearance, or `"system"` to hand the choice back to macOS. */
export type AppearancePreference = Appearance | "system";

/** Where the appearance in force came from. */
export type AppearanceSource = "system" | "override";

export interface ThemeState {
	ok: true;
	appearance: Appearance;
	source: AppearanceSource;
}

/** The native half: `-[NSApplication setAppearance:]` and the effective appearance. */
export interface ThemeAdapter {
	/** The appearance the app is drawing in right now, override included. */
	current(): Appearance;
	/** `"system"` clears the override, so the OS decides again. */
	set(appearance: AppearancePreference): void;
}

export type ThemePlugin = PluginDefinition<
	"theme",
	{
		current: () => ThemeState | NotImplemented;
		set: (
			args: { appearance: AppearancePreference },
			ctx: PluginContext,
		) => ThemeState | NotImplemented;
		reset: (args?: unknown, ctx?: PluginContext) => ThemeState | NotImplemented;
	}
>;

/** The event a page listens for after any change. */
export const THEME_CHANGED = "theme:changed";
