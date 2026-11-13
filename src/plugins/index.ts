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

/** The four plugins v1 ships. */
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
