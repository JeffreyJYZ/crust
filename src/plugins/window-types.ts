/**
 * `crust:window`'s public vocabulary: what a create asks for, what the native
 * half must supply, and every shape a command answers.
 *
 * Split out of `window.ts` so the contract stays readable beside the command
 * implementations; `window.ts` re-exports all of it, so importers keep using
 * the same path.
 */

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
