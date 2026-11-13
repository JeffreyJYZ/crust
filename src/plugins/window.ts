/**
 * `crust:window` — window control: create, close, focus, title, list, isOpen.
 *
 * `NSWindow` is AppKit, and this module owns no AppKit. It takes the native
 * implementation as a parameter, so the platform half stays in
 * `platform/darwin` and this file works unchanged on a platform that has none.
 * macOS supplies `darwinWindowAdapter()` from there; without an adapter every
 * command returns a typed `NotImplemented` naming the selector, never a silent
 * undefined and never a resolved fake.
 *
 * `create` is the one command whose native half is *optional*: it arrived after
 * the first five, so an adapter written before it still satisfies
 * {@link WindowNative} and answers `unknown-adapter` here rather than failing to
 * compile. The macOS adapter's `create` is a delegation to
 * `DarwinPlatform.createWindow`, which already owns the `initWithContentRect:`
 * path, the webview and Auto Layout; this file never grows a second one.
 *
 * The adapter contract carries rules the type cannot express: a label it does
 * not track throws `WindowAdapterError("unknown-window")`, and a label it
 * already holds throws `WindowAdapterError("duplicate-label")` instead of
 * replacing the entry — `DarwinPlatform` keeps a closed window addressable, so
 * only it can tell "gone from `list`" from "still in the map". The plugin turns
 * both into values rather than letting a throw escape into the bridge, so a page
 * always gets a shape it can branch on.
 */

import { definePlugin, notImplemented, type NotImplemented, type PluginDefinition } from "./define";

/** What `window.create` asks a platform to build. */
export interface WindowCreateOptions {
	/** The handle every other command finds it by. Duplicates are refused. */
	label: string;
	/** The title applied at creation, through the same read-back as `setTitle`. */
	title?: string;
	/** Content width in points; a positive integer, never clamped. */
	width?: number;
	/** Content height in points; a positive integer, never clamped. */
	height?: number;
	/**
	 * The document to load. Absent means the app's own document — the bridge
	 * the caller is already talking to, which the adapter resolves because only
	 * it knows that origin; a relative path is resolved against the same base.
	 * An absolute URL is handed through unchanged.
	 */
	url?: string;
}

/** The native half, supplied by the platform. */
export interface WindowNative {
	/**
	 * Build a real window with its webview, load `options.url` (or the app's own
	 * document), and track it under `options.label`.
	 *
	 * Optional because it postdates the other five commands: an adapter without
	 * it still satisfies this interface, and the plugin answers
	 * `unknown-adapter` rather than pretending. On macOS the implementation is
	 * `DarwinPlatform.createWindow(options)`, and that method's own documented
	 * limits are the adapter's to close: a relative URL cannot be handed to
	 * `NSURL` (the adapter resolves one against the document it knows), and a
	 * label a *closed* window still holds must be released first with
	 * `platform.window(label)` — measured: without that release, re-creating a
	 * closed label throws `createWindow: window "…" already exists`.
	 */
	create?(options: WindowCreateOptions): { label: string };
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
export type WindowErrorCode =
	| "unknown-window"
	| "invalid-label"
	| "invalid-size"
	| "invalid-url"
	| "duplicate-label"
	| "unknown-adapter"
	| "handler-error";

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

export interface WindowCreateResult {
	readonly ok: true;
	readonly label: string;
	readonly created: true;
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

export interface WindowCreateArgs {
	label: string;
	title?: string;
	width?: number;
	height?: number;
	url?: string;
}

/** The command names, in the order the plugin declares them. */
export const WINDOW_COMMANDS = ["create", "close", "focus", "setTitle", "list", "isOpen"] as const;

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

/** A label already in the platform's map would be replaced, not added. */
function duplicateLabel(label: string): WindowFailure {
	return {
		ok: false,
		code: "duplicate-label",
		message:
			`crust: a window labelled ${JSON.stringify(label)} already exists; ` +
			"a second one would replace it in the platform's map. Close it or pick another label.",
		label,
	};
}

function invalidSize(args: unknown, key: "width" | "height", value: unknown): WindowFailure {
	return {
		ok: false,
		code: "invalid-size",
		message:
			`crust: window.create ${key} must be a positive integer, got ${JSON.stringify(value)}` +
			` in ${JSON.stringify(args)}`,
	};
}

function invalidUrl(args: unknown, value: unknown): WindowFailure {
	return {
		ok: false,
		code: "invalid-url",
		message:
			`crust: window.create url must be a non-empty string when given, got ` +
			`${JSON.stringify(value)} in ${JSON.stringify(args)}`,
	};
}

/** `window.create`'s payload, or the typed reason it cannot be one. */
function parseCreate(
	args: unknown,
): { ok: true; options: WindowCreateOptions } | { ok: false; failure: WindowFailure } {
	const label = readLabel(args);
	if (label === undefined) return { ok: false, failure: invalidLabel(args) };
	const source = args as { title?: unknown; width?: unknown; height?: unknown; url?: unknown };
	const options: WindowCreateOptions = { label };

	// An absent title is the platform's default; a present non-string is refused
	// here so the adapter never receives an argument it would coerce.
	if (source.title !== undefined) {
		if (typeof source.title !== "string") {
			return {
				ok: false,
				failure: {
					ok: false,
					code: "invalid-label",
					message:
						"crust: window.create title must be a string when given, got " +
						`${JSON.stringify(source.title)}`,
					label,
				},
			};
		}
		options.title = source.title;
	}

	// Refused, not clamped: a page that asks for 0 or 12.5 has a bug, and a
	// silently resized window hides it. Same rule as config's `positiveInteger`.
	for (const key of ["width", "height"] as const) {
		const value = source[key];
		if (value === undefined) continue;
		if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
			return { ok: false, failure: invalidSize(args, key, value) };
		}
		options[key] = value;
	}

	// An empty string is not "the app's own document"; it is a page bug that
	// would otherwise reach NSURL as nothing at all.
	if (source.url !== undefined) {
		if (typeof source.url !== "string" || source.url.length === 0) {
			return { ok: false, failure: invalidUrl(args, source.url) };
		}
		options.url = source.url;
	}

	return { ok: true, options };
}

export function createWindowPlugin(adapter?: WindowNative): PluginDefinition<
	"window",
	{
		create: (args: WindowCreateArgs) => WindowCreateResult | WindowFailure | NotImplemented;
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
			/**
			 * The missing-window case this exists for: with five commands a page
			 * could close its only window and never open another, so an app that
			 * wanted a reopen had to keep a hidden window alive. Creation is a
			 * command like any other — typed args, typed failure, and the label
			 * tracked by the platform afterwards, so `list`, `isOpen`, `close` and
			 * `setTitle` all find the new window on the next call.
			 */
			create: (args: WindowCreateArgs) => {
				if (!adapter) return missing("create");
				const native = adapter;
				// The member is optional in the contract, so it is read through a
				// partial view: an adapter written before `create` still type-checks.
				const create = (native as Partial<WindowNative>).create;
				// Asked before the arguments: a platform that cannot create at all
				// should say so rather than answer a validation error about a request
				// it would never have run.
				if (typeof create !== "function") {
					return {
						ok: false as const,
						code: "unknown-adapter" as const,
						message:
							"crust: this window adapter does not implement create. On macOS " +
							"darwinWindowAdapter(platform) must delegate it to " +
							"DarwinPlatform.createWindow(options).",
					};
				}
				const parsed = parseCreate(args);
				if (!parsed.ok) return parsed.failure;
				const options = parsed.options;
				// Only the adapter can tell a closed-but-tracked label from a free
				// one; this check covers what `list` reports, and the adapter throws
				// `duplicate-label` for the rest.
				try {
					if (native.list().includes(options.label)) return duplicateLabel(options.label);
					create.call(native, options);
					// A create that answers without tracking would turn every later
					// command into `unknown-window`; read the platform's own list back
					// rather than trusting the call.
					if (!native.list().includes(options.label)) {
						return {
							ok: false as const,
							code: "handler-error" as const,
							message:
								`crust: window.create reported ${JSON.stringify(options.label)} ` +
								"created, but the adapter does not list it",
							label: options.label,
						};
					}
				} catch (error) {
					return failure(error, options.label);
				}
				return { ok: true as const, label: options.label, created: true as const };
			},
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
