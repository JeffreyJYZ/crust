/**
 * Plugin entry point.
 *
 * `corePlugins` is the four v1 plugins, in the order DESIGN.md §5 lists them.
 * Each is a plain `definePlugin` value, so the same mechanism carries a
 * plugin that works today (`fs`) and three that fail honestly until AppKit or
 * `UNUserNotificationCenter` is reachable.
 */

import { createDialogPlugin, dialogPlugin } from "./dialog";
import { definePlugin, notImplemented, type PluginDefinition } from "./define";
import { fsPlugin } from "./fs";
import { createNotificationPlugin, notificationPlugin } from "./notification";
import { PluginRegistry } from "./registry";
import { createTrayPlugin, trayPlugin } from "./tray";

export {
	type ArgsOf,
	type CommandHandler,
	type CommandMap,
	type CommandSchema,
	type MaybePromise,
	type NotImplemented,
	type PluginContext,
	type PluginDefinition,
	type ResultOf,
	type SchemaOf,
	definePlugin,
	isNotImplemented,
	notImplemented,
	NotImplementedError,
} from "./define";
export {
	createDialogPlugin,
	type DialogNative,
	dialogPlugin,
	type OpenPanelOptions,
	type OpenPanelResult,
} from "./dialog";
export {
	fsPlugin,
	type ReadTextFileArgs,
	type WriteTextFileArgs,
	type WriteTextFileResult,
} from "./fs";
export {
	createNotificationPlugin,
	type NotificationNative,
	type NotificationPermission,
	type NotifyOptions,
	type NotifyResult,
	notificationPlugin,
} from "./notification";
export { handlerMap, type HandlerSource, PluginRegistry } from "./registry";
export {
	createTrayPlugin,
	type TrayNative,
	trayPlugin,
	type TrayOptions,
	type TrayResult,
} from "./tray";
export {
	createWindowPlugin,
	WINDOW_COMMANDS,
	WindowAdapterError,
	type WindowCloseResult,
	type WindowErrorCode,
	type WindowFailure,
	type WindowFocusResult,
	type WindowLabelArgs,
	type WindowListResult,
	type WindowNative,
	type WindowOpenResult,
	type WindowSetTitleArgs,
	type WindowTitleResult,
	windowPlugin,
} from "./window";

/**
 * The four plugins that need no platform instance. `window` sits outside this
 * list because its adapter needs the running `DarwinPlatform` to read labels
 * from, which only `startApp` has; the runtime appends it before selection, so
 * its name still matches `config.plugins`.
 */
export const corePlugins = [
	fsPlugin,
	dialogPlugin,
	notificationPlugin,
	trayPlugin,
] as const satisfies readonly PluginDefinition[];

/** Every core plugin in one registry, ready for `startBridge({ handlers })`. */
export function coreRegistry(): PluginRegistry {
	return new PluginRegistry().register(...corePlugins);
}
