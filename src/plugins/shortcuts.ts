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

export type {
	ShortcutArgs,
	ShortcutFailure,
	ShortcutFailureCode,
	ShortcutResult,
	ShortcutSuccess,
} from "./shortcut-types";
import type {
	ShortcutArgs,
	ShortcutFailure,
	ShortcutFailureCode,
	ShortcutResult,
} from "./shortcut-types";

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
		) => { removed: number } | ShortcutFailure | NotImplemented;
		isRegistered: (args: ShortcutArgs) => boolean | NotImplemented;
		list: () => string[] | NotImplemented;
	}
> & { dispose(): void } {
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
	/** The adapter's unsubscribe, retained so a caller can detach the press channel. */
	const detachTrigger = adapter?.onTrigger((accelerator) => sink?.("shortcut", { accelerator }));

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

	const plugin = definePlugin({
		name: "shortcut",
		native: { requires: "RegisterEventHotKey", available: adapter !== undefined },
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
				if (!adapter.unregister(parsed)) {
					// The OS still has the hot key: keep it in the registry so a retry reaches the OS
					// again instead of silently losing track of a key that keeps firing.
					return refusal(
						"native-failed",
						`shortcut.unregister: the OS refused to remove ${parsed.accelerator}`,
						parsed.accelerator,
					);
				}
				live.delete(parsed.accelerator);
				return { ok: true, accelerator: parsed.accelerator } as const;
			},
			unregisterAll: (_args?: unknown, ctx?: PluginContext) => {
				if (!adapter) return missing("unregisterAll");
				if (ctx) sink = ctx.emit;
				const held = live.size;
				let removed: number;
				try {
					removed = adapter.unregisterAll();
				} catch (error) {
					const detail = error instanceof Error ? error.message : String(error);
					return refusal(
						"native-failed",
						`shortcut.unregisterAll: the OS refused to remove the hot keys${detail ? `: ${detail}` : ""}`,
					);
				}
				if (held > 0 && removed === 0) {
					// The adapter swallowed a native failure into 0. Answering { removed: 0 } while the
					// keys still fire is a lie, and clearing the registry loses the only retry path.
					return refusal(
						"native-failed",
						`shortcut.unregisterAll: the OS refused to remove ${held} registered hot key(s)`,
					);
				}
				live.clear();
				return { removed };
			},
			/**
			 * Both reads are answered from the plugin's own map, so it is tempting to skip the
			 * adapter check — but then a missing native half is the same `false` or `[]` a real
			 * registry gives when nothing is held. Refuse by name instead; a cancelled pick has
			 * its own shape, and so does an empty hot-key list.
			 */
			isRegistered: (args: ShortcutArgs): boolean | NotImplemented => {
				if (!adapter) return missing("isRegistered");
				try {
					return live.has(parseAccelerator(args?.accelerator).accelerator);
				} catch {
					return false;
				}
			},
			list: (): string[] | NotImplemented => {
				if (!adapter) return missing("list");
				return [...live.keys()];
			},
		},
	});
	let disposed = false;
	return Object.freeze({
		...plugin,
		/** Detach the native press handler; idempotent, so repeated teardown is safe. */
		dispose: () => {
			if (disposed) return;
			disposed = true;
			detachTrigger?.();
		},
	});
}

/** The default registration: honest about the missing framework. */
export const shortcutsPlugin = createShortcutsPlugin();
