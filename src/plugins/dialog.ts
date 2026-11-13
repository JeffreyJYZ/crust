/**
 * `crust:dialog` — native open panels.
 *
 * `NSOpenPanel` is AppKit, and this module owns no AppKit. It takes the native
 * implementation as a parameter, so the day the shim exposes `NSOpenPanel` the
 * only change is passing one adapter in; until then `openPanel` returns a typed
 * `NotImplemented` naming the selector, and the registry turns that into a
 * `not-implemented` error. It never silently resolves an empty list.
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

/** The AppKit half, supplied once `NSOpenPanel` is reachable. */
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
