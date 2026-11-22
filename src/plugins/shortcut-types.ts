/**
 * The vocabulary `crust:shortcut` answers with. Kept apart from the factory so the result types
 * can be imported without pulling in the accelerator parser or the plugin registry.
 */

export type ShortcutFailureCode =
	| "bad-accelerator"
	| "already-registered"
	| "not-registered"
	| "native-failed";

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
