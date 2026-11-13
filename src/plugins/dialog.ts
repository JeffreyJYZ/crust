/**
 * `crust:dialog` — native open panels.
 *
 * `NSOpenPanel` is AppKit, and this module owns no AppKit. It takes the native
 * implementation as a parameter, so the platform half stays in
 * `platform/darwin` and this file works unchanged on a platform that has none.
 * macOS supplies `darwinDialogAdapter()` from there; without an adapter
 * `openPanel` returns a typed `NotImplemented` naming the selector, and the
 * registry turns that into a `not-implemented` error. It never silently
 * resolves an empty list for a missing implementation — an empty list means the
 * user cancelled, and nothing else.
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

/**
 * The native half, supplied by the platform.
 *
 * Resolving `{ paths: [] }` means the user cancelled; a platform that cannot
 * show a picker at all rejects instead, so the two are never confused. An
 * implementation built on `-runModal` blocks the JavaScript thread for as long
 * as the picker is open — see `darwinDialogAdapter` in `platform/darwin`.
 */
export interface DialogNative {
	pickOpen(options: OpenPanelOptions): Promise<OpenPanelResult>;
}

export function createDialogPlugin(native?: DialogNative): PluginDefinition<
	"dialog",
	{
		openPanel: (options: OpenPanelOptions) => Promise<OpenPanelResult | NotImplemented>;
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
		},
	});
}

/** The default registration: honest about the missing selector. */
export const dialogPlugin = createDialogPlugin();
