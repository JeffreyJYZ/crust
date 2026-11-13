/**
 * `crust:dialog` — native file panels.
 *
 * `NSOpenPanel` and `NSSavePanel` are AppKit, and this module owns no AppKit. It
 * takes the native implementation as a parameter, so the platform half stays in
 * `platform/darwin` and this file works unchanged on a platform that has none.
 * macOS supplies `darwinDialogAdapter()` from there; without an adapter the
 * command returns a typed `NotImplemented` naming the selector, and the registry
 * turns that into a `not-implemented` error. It never silently resolves an empty
 * list for a missing implementation — an empty list means the user cancelled,
 * and nothing else.
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
 * The native half, supplied by the platform.
 *
 * Resolving `{ paths: [] }` means the user cancelled; a platform that cannot
 * show a picker at all rejects instead, so the two are never confused. macOS
 * shows the panel as a sheet and awaits it without blocking the JavaScript
 * thread, so an invoke issued while the sheet is up is still answered; the one
 * blocking path is the `-runModal` fallback used when there is no window to
 * attach a sheet to — see `darwinDialogAdapter` in `platform/darwin`.
 *
 * `pickSave` is optional so an adapter written before the save panel existed
 * keeps type-checking; `savePanel` then answers `not-implemented` naming
 * `NSSavePanel`, which is the honest answer for that adapter.
 */
export interface DialogNative {
	pickOpen(options: OpenPanelOptions): Promise<OpenPanelResult>;
	pickSave?(options: SavePanelOptions): Promise<SavePanelResult>;
}

export function createDialogPlugin(native?: DialogNative): PluginDefinition<
	"dialog",
	{
		openPanel: (options: OpenPanelOptions) => Promise<OpenPanelResult | NotImplemented>;
		savePanel: (options: SavePanelOptions) => Promise<SavePanelResult | NotImplemented>;
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
		},
	});
}

/** The default registration: honest about the missing selector. */
export const dialogPlugin = createDialogPlugin();
