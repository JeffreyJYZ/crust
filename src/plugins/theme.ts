/**
 * `crust:theme` — the appearance a page should render in, and the override that outranks the system. `current()` reports what the app draws in now and whether that came from the system or from a page; `set` and `reset` change it and push `theme:changed`, so a page that already rendered follows without polling.
 * The appearance is read back from the adapter after every change, so the answer is what the app shows rather than an echo of the argument, and `source` says whether a page asked for it.
 */

import { CrustError } from "../bridge/errors";
import { definePlugin, notImplemented, type NotImplemented, type PluginContext } from "./define";
import type {
	Appearance,
	AppearancePreference,
	ThemeAdapter,
	ThemePlugin,
	ThemeState,
} from "./theme-types";
import { THEME_CHANGED } from "./theme-types";

export { THEME_CHANGED } from "./theme-types";
export type {
	Appearance,
	AppearancePreference,
	AppearanceSource,
	ThemeAdapter,
	ThemePlugin,
	ThemeState,
} from "./theme-types";

function isPreference(value: unknown): value is AppearancePreference {
	return value === "light" || value === "dark" || value === "system";
}

export function createThemePlugin(adapter?: ThemeAdapter): ThemePlugin {
	const native = adapter;
	/** The appearance a page chose; `undefined` means the system's own. */
	let override: Appearance | undefined;

	const missing = (command: string): NotImplemented =>
		notImplemented(
			`theme.${command} needs -[NSApplication setAppearance:] and +[NSAppearance appearanceNamed:], which only AppKit provides. Pass a ThemeAdapter to createThemePlugin on a platform that has none.`,
			"NSAppearance",
		);

	const state = (target: ThemeAdapter): ThemeState => ({
		ok: true,
		appearance: target.current(),
		source: override === undefined ? "system" : "override",
	});

	const publish = (ctx: PluginContext | undefined, next: ThemeState): ThemeState => {
		ctx?.emit(THEME_CHANGED, { appearance: next.appearance, source: next.source });
		return next;
	};

	return definePlugin({
		name: "theme",
		commands: {
			/** What the app draws in now, and whether a page asked for it. */
			current: (): ThemeState | NotImplemented =>
				native ? state(native) : missing("current"),
			/** Apply an appearance and tell every page; the state is read back from the app. */
			set: (
				args: { appearance: AppearancePreference },
				ctx: PluginContext,
			): ThemeState | NotImplemented => {
				if (!native) return missing("set");
				const appearance = args?.appearance;
				if (!isPreference(appearance)) {
					throw new CrustError(
						"bad-request",
						'theme.set: "appearance" must be "light", "dark" or "system"',
					);
				}
				native.set(appearance);
				override = appearance === "system" ? undefined : appearance;
				return publish(ctx, state(native));
			},
			/** Hand the choice back to the system, which is what `set({ appearance: "system" })` does. */
			reset: (_args?: unknown, ctx?: PluginContext): ThemeState | NotImplemented => {
				if (!native) return missing("reset");
				native.set("system");
				override = undefined;
				return publish(ctx, state(native));
			},
		},
	});
}

/** The default registration: no AppKit, so every command answers honestly. */
export const themePlugin = createThemePlugin();
