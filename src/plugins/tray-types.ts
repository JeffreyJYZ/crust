/**
 * `crust:tray`'s public vocabulary: what a menu row is, what the native half
 * must supply, and every shape a command answers.
 *
 * Split out of `tray.ts` so the contract reads beside the commands; `tray.ts`
 * re-exports all of it, so importers keep using the same path.
 */

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
