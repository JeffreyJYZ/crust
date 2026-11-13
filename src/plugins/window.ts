/**
 * `crust:window` — window control: close, focus, title, list, isOpen.
 *
 * `NSWindow` is AppKit, and this module owns no AppKit. It takes the native
 * implementation as a parameter, so the platform half stays in
 * `platform/darwin` and this file works unchanged on a platform that has none.
 * macOS supplies `darwinWindowAdapter()` from there; without an adapter every
 * command returns a typed `NotImplemented` naming the selector, never a silent
 * undefined and never a resolved fake.
 *
 * The adapter contract has one rule the type cannot express: a label it does
 * not track throws `WindowAdapterError("unknown-window")`. The plugin turns
 * that into `{ ok: false, code: "unknown-window" }` rather than letting a
 * throw escape into the bridge, so a page always gets a value it can branch on.
 */

import { definePlugin, notImplemented, type NotImplemented, type PluginDefinition } from "./define";

/** The native half, supplied by the platform. */
export interface WindowNative {
	/** Order the window out. Unknown labels throw `WindowAdapterError`. */
	close(label: string): void;
	/** Bring the window to the front. Unknown labels throw `WindowAdapterError`. */
	focus(label: string): void;
	/** Replace the title. Unknown labels throw `WindowAdapterError`. */
	setTitle(label: string, title: string): void;
	/** Every label the platform still tracks. */
	list(): string[];
	/**
	 * Whether the window is still open. A minimised window is open, and so is a
	 * window in a hidden app, so this is never an `isVisible` test; on macOS it
	 * is not a `-windowNumber` test either, because AppKit keeps that number
	 * after `-close`. The platform owns the rule.
	 */
	isOpen(label: string): boolean;
}

/** Why a window command could not answer. */
export type WindowErrorCode = "unknown-window" | "invalid-label" | "handler-error";

/** The typed failure every command returns instead of throwing or resolving undefined. */
export interface WindowFailure {
	readonly ok: false;
	readonly code: WindowErrorCode;
	readonly message: string;
	readonly label?: string;
}

export interface WindowCloseResult {
	readonly ok: true;
	readonly label: string;
	readonly closed: true;
}

export interface WindowFocusResult {
	readonly ok: true;
	readonly label: string;
	readonly focused: true;
}

export interface WindowTitleResult {
	readonly ok: true;
	readonly label: string;
	readonly title: string;
}

export interface WindowListResult {
	readonly ok: true;
	readonly labels: string[];
}

export interface WindowOpenResult {
	readonly ok: true;
	readonly label: string;
	readonly open: boolean;
}

/**
 * What an adapter throws for a label it cannot act on. It is a plain `Error`
 * subclass on purpose: the plugin converts it, the bridge never sees it.
 */
export class WindowAdapterError extends Error {
	readonly code: WindowErrorCode;

	constructor(code: WindowErrorCode, message: string) {
		super(message);
		this.name = "WindowAdapterError";
		this.code = code;
	}
}

export interface WindowLabelArgs {
	label: string;
}

export interface WindowSetTitleArgs {
	label: string;
	title: string;
}

/** The command names, in the order the plugin declares them. */
export const WINDOW_COMMANDS = ["close", "focus", "setTitle", "list", "isOpen"] as const;

/**
 * A page payload is whatever the bridge parsed, so the label is read
 * defensively: a missing or non-string label is its own typed error.
 */
function readLabel(args: unknown): string | undefined {
	if (typeof args !== "object" || args === null) return undefined;
	const value = (args as { label?: unknown }).label;
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function invalidLabel(args: unknown): WindowFailure {
	const seen = typeof args === "object" && args !== null ? JSON.stringify(args) : String(args);
	return {
		ok: false,
		code: "invalid-label",
		message: `crust: window command needs { label } with a non-empty string, got ${seen}`,
	};
}

/** Any adapter throw becomes a value; nothing escapes into the bridge. */
function failure(error: unknown, label?: string): WindowFailure {
	const code = error instanceof WindowAdapterError ? error.code : "handler-error";
	const message = error instanceof Error ? error.message : String(error);
	return label === undefined ? { ok: false, code, message } : { ok: false, code, message, label };
}

function unknownWindow(label: string): WindowFailure {
	return {
		ok: false,
		code: "unknown-window",
		message: `crust: no window labelled ${JSON.stringify(label)}`,
		label,
	};
}

export function createWindowPlugin(adapter?: WindowNative): PluginDefinition<
	"window",
	{
		close: (args: WindowLabelArgs) => WindowCloseResult | WindowFailure | NotImplemented;
		focus: (args: WindowLabelArgs) => WindowFocusResult | WindowFailure | NotImplemented;
		setTitle: (args: WindowSetTitleArgs) => WindowTitleResult | WindowFailure | NotImplemented;
		list: () => WindowListResult | WindowFailure | NotImplemented;
		isOpen: (args: WindowLabelArgs) => WindowOpenResult | WindowFailure | NotImplemented;
	}
> {
	const missing = (command: string) =>
		notImplemented(
			`window.${command} needs NSWindow, which the AppKit shim does not expose here. ` +
				"Pass a WindowNative adapter to createWindowPlugin on a platform that has one.",
			"NSWindow",
		);

	/**
	 * A label the adapter does not list is unknown before any selector is sent.
	 * Liveness is the adapter's call; existence is answered here so the typed
	 * error does not depend on every adapter remembering to throw.
	 */
	const known = (native: WindowNative, label: string): WindowFailure | undefined =>
		native.list().includes(label) ? undefined : unknownWindow(label);

	const act = <Result>(
		command: string,
		run: (native: WindowNative, label: string) => Result,
		args: unknown,
	): Result | WindowFailure | NotImplemented => {
		if (!adapter) return missing(command);
		const native = adapter;
		const label = readLabel(args);
		if (label === undefined) return invalidLabel(args);
		const unknown = known(native, label);
		if (unknown) return unknown;
		try {
			return run(native, label);
		} catch (error) {
			return failure(error, label);
		}
	};

	return definePlugin({
		name: "window",
		commands: {
			close: (args: WindowLabelArgs) =>
				act(
					"close",
					(native, label) => {
						native.close(label);
						return { ok: true as const, label, closed: true as const };
					},
					args,
				),
			focus: (args: WindowLabelArgs) =>
				act(
					"focus",
					(native, label) => {
						native.focus(label);
						return { ok: true as const, label, focused: true as const };
					},
					args,
				),
			setTitle: (args: WindowSetTitleArgs) => {
				if (!adapter) return missing("setTitle");
				const native = adapter;
				const label = readLabel(args);
				if (label === undefined) return invalidLabel(args);
				const title = typeof args?.title === "string" ? args.title : undefined;
				if (title === undefined) {
					return {
						ok: false as const,
						code: "invalid-label" as const,
						message:
							"crust: window.setTitle needs { label, title } with a string title",
						label,
					};
				}
				const unknown = known(native, label);
				if (unknown) return unknown;
				try {
					native.setTitle(label, title);
					return { ok: true as const, label, title };
				} catch (error) {
					return failure(error, label);
				}
			},
			list: () => {
				if (!adapter) return missing("list");
				try {
					return { ok: true as const, labels: [...adapter.list()] };
				} catch (error) {
					return failure(error);
				}
			},
			isOpen: (args: WindowLabelArgs) =>
				act(
					"isOpen",
					(native, label) => ({ ok: true as const, label, open: native.isOpen(label) }),
					args,
				),
		},
	});
}

/** The default registration: honest about the missing platform. */
export const windowPlugin = createWindowPlugin();
