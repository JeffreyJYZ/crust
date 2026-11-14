/**
 * `crust:tray` — a menu-bar status item. `NSStatusBar` is AppKit and this module owns none: the native half is a `TrayNative` adapter from `createStatusBar()`, so the same commands work on a platform with no menu bar; without one every command returns a typed `NotImplemented` naming `NSStatusBar`, never a fake success — a tray that silently did nothing is indistinguishable from one that failed.
 * The five commands are the item's life (title, menu, visibility, removal), each with its own answer. A menu entry may carry `onClick` for in-process callers, but the bridge transports JSON, so every click is also pushed as a `tray:click` event with `{ index, label }`. Vocabulary in `tray-types.ts`, argument rules in `tray-args.ts`.
 */

import {
	definePlugin,
	notImplemented,
	type NotImplemented,
	type PluginContext,
	type PluginDefinition,
} from "./define";
import { emitClick, failure, invalidMenu, invalidText, readItems, readText } from "./tray-args.ts";
import type {
	TrayDestroyResult,
	TrayFailure,
	TrayMenuResult,
	TrayNative,
	TrayResult,
	TraySetMenuArgs,
	TraySetTitleArgs,
	TrayTitleResult,
} from "./tray-types.ts";

export * from "./tray-types.ts";

export function createTrayPlugin(adapter?: TrayNative): PluginDefinition<
	"tray",
	{
		setTitle: (args: TraySetTitleArgs) => TrayTitleResult | TrayFailure | NotImplemented;
		setMenu: (
			args: TraySetMenuArgs,
			ctx?: PluginContext,
		) => TrayMenuResult | TrayFailure | NotImplemented;
		show: () => TrayResult | TrayFailure | NotImplemented;
		hide: () => TrayResult | TrayFailure | NotImplemented;
		destroy: () => TrayDestroyResult | TrayFailure | NotImplemented;
	}
> {
	const missing = (command: string) =>
		notImplemented(
			`tray.${command} needs NSStatusBar and NSStatusItem, which this platform does not ` +
				"expose. Pass a TrayNative adapter to createTrayPlugin on a platform that has one.",
			"NSStatusBar",
		);

	/**
	 * Run one adapter call, converting an absent adapter (not-implemented), an
	 * adapter without that member (unknown-adapter) and any throw (typed
	 * handler-error) into a value a page can branch on.
	 */
	const act = <Result>(
		command: keyof TrayNative,
		run: (native: TrayNative) => Result,
	): Result | TrayFailure | NotImplemented => {
		if (!adapter) return missing(command);
		const native: Partial<TrayNative> = adapter;
		if (typeof native[command] !== "function") {
			return {
				ok: false,
				code: "unknown-adapter",
				message: `crust: tray adapter does not implement ${command}`,
			};
		}
		try {
			return run(native as TrayNative);
		} catch (error) {
			return failure(error);
		}
	};

	return definePlugin({
		name: "tray",
		commands: {
			setTitle: (args: TraySetTitleArgs): TrayTitleResult | TrayFailure | NotImplemented => {
				if (!adapter) return missing("setTitle");
				const text = readText(args);
				if (text === undefined) return invalidText(args);
				const result = act("setTitle", (native) => native.setTitle(text));
				if (result !== undefined && (result as TrayFailure).ok === false) return result;
				return { ok: true, text };
			},

			setMenu: (
				args: TraySetMenuArgs,
				ctx?: PluginContext,
			): TrayMenuResult | TrayFailure | NotImplemented => {
				if (!adapter) return missing("setMenu");
				const items = readItems(args);
				if (typeof items === "string") return invalidMenu(args, items);

				// A page cannot send a function, so the click is also an event.
				const wired = items.map((item, index) => ({
					label: item.label,
					onClick: () => {
						try {
							item.onClick?.();
						} catch {
							// The adapter already isolates AppKit; a handler must not throw here.
						}
						emitClick(ctx, { index, label: item.label });
					},
				}));

				const result = act("setMenu", (native) => native.setMenu(wired));
				if (result !== undefined && (result as TrayFailure).ok === false) return result;
				return { ok: true, labels: wired.map((item) => item.label) };
			},

			show: (): TrayResult | TrayFailure | NotImplemented => {
				const result = act("show", (native) => native.show());
				if (result !== undefined && (result as TrayFailure).ok === false) return result;
				return { ok: true, active: true };
			},

			hide: (): TrayResult | TrayFailure | NotImplemented => {
				const result = act("hide", (native) => native.hide());
				if (result !== undefined && (result as TrayFailure).ok === false) return result;
				return { ok: true, active: false };
			},

			destroy: (): TrayDestroyResult | TrayFailure | NotImplemented => {
				const result = act("destroy", (native) => native.destroy());
				if (result !== undefined && (result as TrayFailure).ok === false) return result;
				return { ok: true, destroyed: true };
			},
		},
	});
}

/** The default registration: honest about the missing platform. */
export const trayPlugin = createTrayPlugin();
