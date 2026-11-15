/**
 * `crust:shortcut` — process-wide hot keys, Tauri's `global-shortcut` surface. The plugin owns the registry; the grammar is `shortcut-accelerator.ts` and macOS supplies `darwinShortcutsAdapter()`, so a caller with no adapter gets a typed `NotImplemented`.
 * Registration answers a result rather than throwing, because a malformed accelerator has to name the token at fault: `part` is that token, verbatim.
 */

import {
	AcceleratorError,
	parseAccelerator,
	type ParsedAccelerator,
	type ShortcutModifier,
} from "./shortcut-accelerator";
import {
	definePlugin,
	notImplemented,
	type NotImplemented,
	type PluginContext,
	type PluginDefinition,
} from "./define";

export {
	AcceleratorError,
	type ParsedAccelerator,
	parseAccelerator,
	type ShortcutModifier,
} from "./shortcut-accelerator";

export type ShortcutFailureCode =
	"bad-accelerator" | "already-registered" | "not-registered" | "native-failed";

export interface ShortcutFailure {
	ok: false;
	code: ShortcutFailureCode;
	message: string;
	/** The accelerator or token at fault, when one can be named. */
	part?: string;
}

export interface ShortcutSuccess {
	ok: true;
	accelerator: string;
}

export type ShortcutResult = ShortcutSuccess | ShortcutFailure;

export interface ShortcutArgs {
	accelerator: string;
}

/**
 * The native half. It owns only the OS: the plugin keeps the registry, so an adapter
 * never has to answer `list` or `isRegistered` and a fake stays trivial.
 */
export interface ShortcutAdapter {
	register(parsed: ParsedAccelerator): ShortcutResult;
	unregister(parsed: ParsedAccelerator): boolean;
	unregisterAll(): number;
	/** Called with the canonical accelerator when a hot key fires; returns an unsubscribe. */
	onTrigger(handler: (accelerator: string) => void): () => void;
}

function refusal(code: ShortcutFailureCode, message: string, part?: string): ShortcutFailure {
	return part === undefined ? { ok: false, code, message } : { ok: false, code, message, part };
}

export function createShortcutsPlugin(adapter?: ShortcutAdapter): PluginDefinition<
	"shortcut",
	{
		register: (args: ShortcutArgs, ctx: PluginContext) => ShortcutResult | NotImplemented;
		unregister: (args: ShortcutArgs, ctx: PluginContext) => ShortcutResult | NotImplemented;
		unregisterAll: (
			args?: unknown,
			ctx?: PluginContext,
		) => { removed: number } | NotImplemented;
		isRegistered: (args: ShortcutArgs) => boolean;
		list: () => string[];
	}
> {
	const live = new Map<string, ParsedAccelerator>();
	const missing = (command: string) =>
		notImplemented(
			`shortcut.${command} needs RegisterEventHotKey: no adapter was passed to createShortcutsPlugin, so nothing can reach the window server. Pass darwinShortcutsAdapter() on macOS.`,
			"RegisterEventHotKey",
		);

	// A hot key fires outside any command, and `emit` only exists for the length of
	// one, so the most recent context is the channel it has. A hot key cannot exist
	// before `register` ran, which is what makes that channel already set.
	let sink: PluginContext["emit"] | undefined;
	adapter?.onTrigger((accelerator) => sink?.("shortcut", { accelerator }));

	const parse = (args: ShortcutArgs): ParsedAccelerator | ShortcutFailure => {
		try {
			return parseAccelerator(args?.accelerator);
		} catch (error) {
			if (error instanceof AcceleratorError) {
				return refusal("bad-accelerator", error.message, error.part);
			}
			throw error;
		}
	};

	return definePlugin({
		name: "shortcut",
		commands: {
			register: (args: ShortcutArgs, ctx: PluginContext) => {
				if (!adapter) return missing("register");
				sink = ctx.emit;
				const parsed = parse(args);
				if ("ok" in parsed) return parsed;
				if (live.has(parsed.accelerator)) {
					return refusal(
						"already-registered",
						`shortcut.register: ${parsed.accelerator} is already registered`,
						parsed.accelerator,
					);
				}
				const result = adapter.register(parsed);
				if (result.ok) live.set(parsed.accelerator, parsed);
				return result;
			},
			unregister: (args: ShortcutArgs, ctx: PluginContext) => {
				if (!adapter) return missing("unregister");
				sink = ctx.emit;
				const parsed = parse(args);
				if ("ok" in parsed) return parsed;
				if (!live.has(parsed.accelerator)) {
					return refusal(
						"not-registered",
						`shortcut.unregister: ${parsed.accelerator} is not registered`,
						parsed.accelerator,
					);
				}
				adapter.unregister(parsed);
				live.delete(parsed.accelerator);
				return { ok: true, accelerator: parsed.accelerator };
			},
			unregisterAll: (_args?: unknown, ctx?: PluginContext) => {
				if (!adapter) return missing("unregisterAll");
				if (ctx) sink = ctx.emit;
				const removed = adapter.unregisterAll();
				live.clear();
				return { removed };
			},
			isRegistered: (args: ShortcutArgs) => {
				try {
					return live.has(parseAccelerator(args?.accelerator).accelerator);
				} catch {
					return false;
				}
			},
			list: () => [...live.keys()],
		},
	});
}

/** The default registration: honest about the missing framework. */
export const shortcutsPlugin = createShortcutsPlugin();
