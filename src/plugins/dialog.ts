/**
 * `crust:dialog` — native file panels. `NSOpenPanel`/`NSSavePanel` are AppKit and this module owns none: the native half arrives as a parameter, so it works unchanged on a platform that has none.
 * Without an adapter the command returns a typed `NotImplemented` naming the selector and the registry makes that a `not-implemented` error. It never resolves an empty list for a missing implementation — an empty list means the user cancelled, and nothing else.
 */

import { definePlugin, notImplemented, type NotImplemented, type PluginDefinition } from "./define";

export interface OpenPanelFilter {
	name: string;
	extensions: readonly string[];
}

export interface OpenPanelOptions {
	title?: string;
	/** Allow more than one path. Defaults to false. */
	multiple?: boolean;
	/** Pick directories instead of files. Defaults to false. */
	directory?: boolean;
	filters?: readonly OpenPanelFilter[];
}

export interface OpenPanelResult {
	paths: string[];
}

export interface SavePanelOptions {
	title?: string;
	/**
	 * The name the panel offers to save under, e.g. `"notes.txt"`. A bare file
	 * name, not a path: the panel still owns the directory, and the user can
	 * change both before answering.
	 */
	suggestedName?: string;
	/** The extensions the panel offers. Empty or absent means any file type. */
	filters?: readonly OpenPanelFilter[];
}

/**
 * A save panel picks exactly one file, so `paths` holds one entry on a pick and
 * none on a cancel — the same shape as `OpenPanelResult`, and `[]` still means
 * the user cancelled rather than "no adapter".
 */
export type SavePanelResult = OpenPanelResult;

/**
 * What `cancel` answers. `paths` is always empty — a cancel resolves the same empty list a human's Cancel button gives — and `cancelled` says whether a sheet was actually up: `false` means nothing was left to end, an ordinary race with the user, never an error.
 */
export interface CancelPanelResult {
	cancelled: boolean;
	paths: string[];
}

/**
 * The native half, supplied by the platform. `{ paths: [] }` means the user cancelled; a platform that cannot show a picker at all rejects, so the two are never confused.
 * macOS shows the panel as a sheet without blocking the JavaScript thread, so an invoke issued while it is up is still answered; the one blocking path is `-runModal`, the fallback when there is no window to attach a sheet to (`darwinDialogAdapter`). `pickSave` and `cancel` are optional so an adapter written before them keeps type-checking and answers `not-implemented` naming the selector; `cancel` exists because a sheet is otherwise dismissible only by a human, and with one sheet at a time it is also how a refused `openPanel`/`savePanel` frees the slot.
 */
export interface DialogNative {
	pickOpen(options: OpenPanelOptions): Promise<OpenPanelResult>;
	pickSave?(options: SavePanelOptions): Promise<SavePanelResult>;
	cancel?(): Promise<CancelPanelResult>;
}

export function createDialogPlugin(native?: DialogNative): PluginDefinition<
	"dialog",
	{
		openPanel: (options: OpenPanelOptions) => Promise<OpenPanelResult | NotImplemented>;
		savePanel: (options: SavePanelOptions) => Promise<SavePanelResult | NotImplemented>;
		cancel: () => Promise<CancelPanelResult | NotImplemented>;
	}
> {
	return definePlugin({
		name: "dialog",
		commands: {
			openPanel: async (
				options: OpenPanelOptions = {},
			): Promise<OpenPanelResult | NotImplemented> => {
				if (!native) {
					return notImplemented(
						"dialog.openPanel needs NSOpenPanel, which the AppKit shim does not expose yet. Pass a DialogNative adapter to createDialogPlugin once it does.",
						"NSOpenPanel",
					);
				}
				return native.pickOpen(options);
			},
			/**
			 * The save panel. The native half decides where the file goes; crust
			 * never has a path in mind, which is the gap this closes. AppKit asks
			 * before replacing an existing file, and this layer adds no second
			 * confirmation of its own.
			 */
			savePanel: async (
				options: SavePanelOptions = {},
			): Promise<SavePanelResult | NotImplemented> => {
				if (!native?.pickSave) {
					return notImplemented(
						"dialog.savePanel needs NSSavePanel, which the AppKit shim does not expose yet. Pass a DialogNative adapter with pickSave to createDialogPlugin once it does.",
						"NSSavePanel",
					);
				}
				return native.pickSave(options);
			},
			/**
			 * End the sheet that is up, the way its Cancel button would. Nothing pending
			 * is `{ cancelled: false }` rather than `not-implemented`: an adapter with the
			 * selector simply found no sheet, because the page raced the user's click.
			 * Only an adapter with no `cancel` at all is a gap.
			 */
			cancel: async (): Promise<CancelPanelResult | NotImplemented> => {
				if (!native?.cancel) {
					return notImplemented(
						"dialog.cancel needs -[NSPanel cancel:], which the AppKit shim does not expose yet. Pass a DialogNative adapter with cancel to createDialogPlugin once it does.",
						"cancel:",
					);
				}
				return native.cancel();
			},
		},
	});
}

/** The default registration: honest about the missing selector. */
export const dialogPlugin = createDialogPlugin();
