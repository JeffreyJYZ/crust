/**
 * `crust:tray` — a menu-bar status item.
 *
 * `NSStatusBar` is AppKit, and this module owns no AppKit. The native half is a
 * `TrayNative` adapter, so the platform side stays in `platform/darwin` and the
 * same commands work unchanged on a platform that has no menu bar. macOS
 * supplies one through `createStatusBar()` in `platform/darwin/status-bar.ts`;
 * without an adapter every command returns a typed `NotImplemented` naming
 * `NSStatusBar`, and the registry turns that into a `not-implemented` error. It
 * never resolves a fake success, because a tray that silently did nothing is
 * indistinguishable from one that failed.
 *
 * The five commands are the item's life, not a single `set`: a title, a menu,
 * visibility, and removal each have their own answer. A menu entry may carry an
 * `onClick` for in-process callers, but the bridge transports JSON, so a page
 * cannot send a function. Every click is therefore also pushed as a `tray:click`
 * event carrying `{ index, label }`, which is how page code learns about it.
 */

import {
	definePlugin,
	notImplemented,
	type NotImplemented,
	type PluginContext,
	type PluginDefinition,
} from "./define";

/** A menu row: the label the item shows plus an optional in-process handler. */
export interface TrayMenuItem {
	/** Non-empty text. */
	label: string;
	/** Called when the row is clicked. Over the bridge this cannot arrive; use `tray:click`. */
	onClick?: () => void;
}

/**
 * The v1 option bag, kept for the plugin entry point's re-export.
 *
 * It belongs to the draft where one `set` call carried everything; the five
 * commands replaced it. An adapter that grows an icon or a tooltip can read it,
 * but nothing in these commands does.
 */
export interface TrayOptions {
	/** SF Symbol name or absolute image path. */
	icon?: string;
	/** Initial text beside the icon. */
	title?: string;
	tooltip?: string;
}

/** What `show` and `hide` answer: whether the item is now on the menu bar. */
export interface TrayResult {
	readonly ok: true;
	readonly active: boolean;
}

export interface TrayTitleResult {
	readonly ok: true;
	readonly text: string;
}

export interface TrayMenuResult {
	readonly ok: true;
	readonly labels: string[];
}

export interface TrayDestroyResult {
	readonly ok: true;
	readonly destroyed: true;
}

/** The native half, supplied by the platform. One live item per adapter. */
export interface TrayNative {
	setTitle(text: string): void;
	/** Replace the whole menu. An empty list detaches it. */
	setMenu(items: readonly TrayMenuItem[]): void;
	show(): void;
	hide(): void;
	/** Remove the item and release the adapter's claim on it. */
	destroy(): void;
}

/** Why a tray command could not answer. */
export type TrayErrorCode =
	"invalid-text" | "invalid-menu" | "unknown-adapter" | "destroyed" | "handler-error";

/** The typed failure every command returns instead of throwing or resolving undefined. */
export interface TrayFailure {
	readonly ok: false;
	readonly code: TrayErrorCode;
	readonly message: string;
}

/**
 * What an adapter throws when it refuses an act. It is a plain `Error` subclass
 * on purpose: the plugin converts it, the bridge never sees it.
 */
export class TrayAdapterError extends Error {
	readonly code: TrayErrorCode;

	constructor(code: TrayErrorCode, message: string) {
		super(message);
		this.name = "TrayAdapterError";
		this.code = code;
	}
}

export interface TraySetTitleArgs {
	text: string;
}

export interface TraySetMenuArgs {
	items: readonly TrayMenuItem[];
}

/** The command names, in the order the plugin declares them. */
export const TRAY_COMMANDS = ["setTitle", "setMenu", "show", "hide", "destroy"] as const;

/** Any adapter throw becomes a value; nothing escapes into the bridge. */
function failure(error: unknown): TrayFailure {
	const code = error instanceof TrayAdapterError ? error.code : "handler-error";
	const message = error instanceof Error ? error.message : String(error);
	return { ok: false, code, message };
}

function invalidText(args: unknown): TrayFailure {
	const seen = typeof args === "object" && args !== null ? JSON.stringify(args) : String(args);
	return {
		ok: false,
		code: "invalid-text",
		message: `crust: tray.setTitle needs { text } with a string, got ${seen}`,
	};
}

function invalidMenu(args: unknown, reason: string): TrayFailure {
	const seen = typeof args === "object" && args !== null ? JSON.stringify(args) : String(args);
	return {
		ok: false,
		code: "invalid-menu",
		message: `crust: tray.setMenu ${reason}, got ${seen}`,
	};
}

/**
 * A page payload is whatever the bridge parsed, so each argument is read
 * defensively: a missing or wrong-typed value is its own typed error rather
 * than a `TypeError` from deep inside the adapter.
 */
function readText(args: unknown): string | undefined {
	if (typeof args !== "object" || args === null) return undefined;
	const value = (args as { text?: unknown }).text;
	return typeof value === "string" ? value : undefined;
}

/** Every row needs a non-empty label; a handler is optional and must be a function. */
function readItems(args: unknown): TrayMenuItem[] | string {
	if (typeof args !== "object" || args === null) return "needs { items }";
	const value = (args as { items?: unknown }).items;
	if (!Array.isArray(value)) return "needs { items } with an array";
	const items: TrayMenuItem[] = [];
	for (let index = 0; index < value.length; index++) {
		const entry: unknown = value[index];
		if (typeof entry !== "object" || entry === null)
			return `needs item ${index} to be an object`;
		const label = (entry as { label?: unknown }).label;
		if (typeof label !== "string" || label.length === 0) {
			return `needs item ${index} to carry a non-empty label`;
		}
		const onClick = (entry as { onClick?: unknown }).onClick;
		if (onClick !== undefined && typeof onClick !== "function") {
			return `needs item ${index}.onClick to be a function when given`;
		}
		items.push({ label, onClick: onClick as (() => void) | undefined });
	}
	return items;
}

function emitClick(ctx: unknown, payload: { index: number; label: string }): void {
	if (typeof ctx !== "object" || ctx === null) return;
	const emit = (ctx as { emit?: unknown }).emit;
	if (typeof emit !== "function") return;
	try {
		(emit as (event: string, data: unknown) => void).call(ctx, "tray:click", payload);
	} catch {
		// A page listener must never turn a click into an exception inside AppKit.
	}
}

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
