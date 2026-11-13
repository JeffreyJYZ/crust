/**
 * `crust:tray` — a menu-bar status item.
 *
 * `NSStatusBar` is AppKit, which this module does not own. The default
 * registration returns a typed `NotImplemented` naming the selector; a
 * `TrayNative` adapter turns the same commands into real work later.
 */

import { definePlugin, notImplemented, type NotImplemented, type PluginDefinition } from "./define";

export interface TrayOptions {
	/** SF Symbol name or absolute image path. */
	icon?: string;
	/** Text beside the icon. */
	title?: string;
	tooltip?: string;
}

export interface TrayResult {
	active: true;
}

export interface TrayNative {
	set(options: TrayOptions): Promise<TrayResult>;
	remove(): Promise<void>;
}

export function createTrayPlugin(native?: TrayNative): PluginDefinition<
	"tray",
	{
		set: (options: TrayOptions) => Promise<TrayResult | NotImplemented>;
		remove: () => Promise<void | NotImplemented>;
	}
> {
	const missing = (command: string) =>
		notImplemented(
			`tray.${command} needs NSStatusBar and NSStatusItem, which the AppKit shim does not expose yet. Pass a TrayNative adapter to createTrayPlugin once it does.`,
			"NSStatusBar",
		);

	return definePlugin({
		name: "tray",
		commands: {
			set: async (options: TrayOptions): Promise<TrayResult | NotImplemented> => {
				if (!native) return missing("set");
				return native.set(options);
			},
			remove: async (): Promise<void | NotImplemented> => {
				if (!native) return missing("remove");
				return native.remove();
			},
		},
	});
}

/** The default registration: honest about the missing selector. */
export const trayPlugin = createTrayPlugin();
