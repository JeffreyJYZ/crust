/**
 * The fixture both `crust:theme` suites share: an adapter that behaves like AppKit (`"system"` clears the override, anything else sets it), a page-side sink so an emitted event is evidence rather than an assumption, and the invoke helper that calls a command the way the bridge does.
 */

import type { Appearance, AppearancePreference, ThemeAdapter, ThemePlugin } from "./theme-types";

export interface FakeTheme {
	adapter: ThemeAdapter;
	/** Every preference the plugin asked for, in order. */
	applied: AppearancePreference[];
}

/** An adapter whose `current()` answers what the app would draw after `set()`. */
export function fake(system: Appearance = "dark"): FakeTheme {
	let override: Appearance | undefined;
	const applied: AppearancePreference[] = [];
	const adapter: ThemeAdapter = {
		current: () => override ?? system,
		set: (appearance) => {
			applied.push(appearance);
			override = appearance === "system" ? undefined : appearance;
		},
	};
	return { adapter, applied };
}

export interface Recorder {
	ctx: { emit(event: string, data: unknown): void };
	events: Array<{ event: string; data: unknown }>;
}

/** A sink that records what a page would have received. */
export function recorder(): Recorder {
	const events: Array<{ event: string; data: unknown }> = [];
	return {
		ctx: {
			emit: (event: string, data: unknown) => {
				events.push({ event, data });
			},
		},
		events,
	};
}

/** Run one command as the bridge does: the handler with its arguments and the page's context. */
export function call(plugin: ThemePlugin, name: string, args?: unknown, ctx?: unknown): unknown {
	const table = plugin.commands as Record<
		string,
		(input?: unknown, context?: unknown) => unknown
	>;
	const handler = table[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return handler(args, ctx);
}
