/**
 * `crust:menu` — the app menu and a context menu, the part of Tauri's `menu` surface a page can ask for: replace the main menu, pop one at a point, restore the default bar.
 * The grammar is `menu-spec.ts` and macOS supplies `darwinMenuAdapter()`, so a caller with no adapter gets a typed `NotImplemented` naming `NSMenu` rather than a silent no-op. Every selection is pushed as `menu` with `{ id }`, where `id` is the item's own or its label.
 */

import {
	definePlugin,
	notImplemented,
	type NotImplemented,
	type PluginContext,
	type PluginDefinition,
} from "./define";
import {
	leafCount,
	MenuSpecError,
	planRow,
	readPoint,
	type MenuFailureCode,
	type MenuItemPlan,
} from "./menu-spec";

export * from "./menu-spec";

export interface MenuFailure {
	readonly ok: false;
	readonly code: MenuFailureCode;
	readonly message: string;
	/** The accelerator token at fault, verbatim, when one can be named. */
	readonly part?: string;
}

export interface MenuResult {
	readonly ok: true;
	/** Selectable rows in the tree, separators and container entries excluded. */
	readonly count: number;
}

export interface MenuResetResult {
	readonly ok: true;
	readonly reset: true;
}

/** The native half. `onSelect` answers an unsubscribe; the plugin relays every id. */
export interface MenuAdapter {
	setAppMenu(items: readonly MenuItemPlan[]): void;
	showContext(
		items: readonly MenuItemPlan[],
		at: { readonly x: number; readonly y: number },
	): void;
	reset(): void;
	onSelect(handler: (id: string) => void): () => void;
}

export function createMenuPlugin(adapter?: MenuAdapter): PluginDefinition<
	"menu",
	{
		setAppMenu: (
			args: unknown,
			ctx?: PluginContext,
		) => MenuResult | MenuFailure | NotImplemented;
		showContext: (
			args: unknown,
			ctx?: PluginContext,
		) => MenuResult | MenuFailure | NotImplemented;
		reset: () => MenuResetResult | MenuFailure | NotImplemented;
	}
> {
	const missing = (command: string) =>
		notImplemented(
			`menu.${command} needs NSMenu: -[NSMenu initWithTitle:], -addItemWithTitle:action:keyEquivalent: and -setMainMenu: are AppKit, and this platform has no adapter for them. Pass a MenuAdapter to createMenuPlugin when one is reachable.`,
			"NSMenu",
		);

	// A selection arrives outside any command, and `emit` exists only for the length
	// of one, so the most recent context is the channel it has. An adapter without
	// `onSelect` cannot report a selection, which is not a reason to fail to build.
	let sink: PluginContext["emit"] | undefined;
	if (typeof adapter?.onSelect === "function") {
		adapter.onSelect((id) => sink?.("menu", { id }));
	}

	const read = (args: unknown, command: string): readonly MenuItemPlan[] => {
		const items = (args as { items?: unknown } | null)?.items;
		if (!Array.isArray(items)) {
			throw new MenuSpecError("bad-items", `menu.${command} needs { items } with an array`);
		}
		const ids = new Set<string>();
		return items.map((entry, index) => planRow(entry, `${command}.items[${index}]`, ids));
	};

	const failed = (error: unknown): MenuFailure => {
		if (error instanceof MenuSpecError) {
			return error.part === undefined
				? { ok: false, code: error.code, message: error.message }
				: { ok: false, code: error.code, message: error.message, part: error.part };
		}
		return {
			ok: false,
			code: "handler-error",
			message: error instanceof Error ? error.message : String(error),
		};
	};

	const attempt = <Result>(body: () => Result): Result | MenuFailure => {
		try {
			return body();
		} catch (error) {
			return failed(error);
		}
	};

	const lacks = (member: keyof MenuAdapter): boolean =>
		typeof (adapter as Partial<MenuAdapter> | undefined)?.[member] !== "function";

	const unknownMember = (member: string): MenuFailure => ({
		ok: false,
		code: "unknown-adapter",
		message: `crust: menu adapter does not implement ${member}`,
	});

	return definePlugin({
		name: "menu",
		commands: {
			setAppMenu: (args: unknown, ctx?: PluginContext) => {
				if (!adapter) return missing("setAppMenu");
				if (lacks("setAppMenu")) return unknownMember("setAppMenu");
				if (ctx) sink = ctx.emit;
				return attempt(() => {
					const items = read(args, "setAppMenu");
					adapter.setAppMenu(items);
					return { ok: true, count: leafCount(items) } satisfies MenuResult;
				});
			},

			showContext: (args: unknown, ctx?: PluginContext) => {
				if (!adapter) return missing("showContext");
				if (lacks("showContext")) return unknownMember("showContext");
				if (ctx) sink = ctx.emit;
				return attempt(() => {
					const items = read(args, "showContext");
					const point = readPoint(args);
					adapter.showContext(items, point);
					return { ok: true, count: leafCount(items) } satisfies MenuResult;
				});
			},

			reset: () => {
				if (!adapter) return missing("reset");
				if (lacks("reset")) return unknownMember("reset");
				return attempt(() => {
					adapter.reset();
					return { ok: true, reset: true } satisfies MenuResetResult;
				});
			},
		},
	});
}

/** The default registration: honest about the missing framework. */
export const menuPlugin = createMenuPlugin();
