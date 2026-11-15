/**
 * Plugin entry point. `corePlugins` is the four v1 plugins in the order the design page (`site/app/docs/design/page.mdx`) lists them, each a plain `definePlugin` value — so the same mechanism carries one that works today (`fs`) and three that fail honestly until AppKit or `UNUserNotificationCenter` is reachable.
 */

import { createAutostartPlugin, autostartPlugin } from "./autostart";
import { createDialogPlugin, dialogPlugin } from "./dialog";
import { definePlugin, notImplemented, type PluginDefinition } from "./define";
import { fsPlugin } from "./fs";
import { createLoggingPlugin, loggingPlugin } from "./logging";
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
	type CancelPanelResult,
	type DialogNative,
	dialogPlugin,
	type OpenPanelOptions,
	type OpenPanelResult,
	type SavePanelOptions,
	type SavePanelResult,
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
	type WindowCreateArgs,
	type WindowCreateOptions,
	type WindowCreateResult,
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

export { createAutostartPlugin, autostartPlugin, type AutostartAdapter } from "./autostart";
export { createClipboardPlugin, clipboardPlugin, type ClipboardAdapter } from "./clipboard";
export { createOpenerPlugin, openerPlugin, type OpenerAdapter } from "./opener";
export { createOsPlugin, osPlugin, type OsAdapter } from "./os";
export { createShortcutsPlugin, shortcutsPlugin, type ShortcutAdapter } from "./shortcuts";
export { createWindowStatePlugin, windowStatePlugin } from "./window-persist";
export { createPositionerPlugin, positionerPlugin } from "./positioner";
export {
	createUpdaterPlugin,
	decodeBase64,
	ED25519_PUBKEY_BYTES,
	ED25519_SIGNATURE_BYTES,
	isEd25519Pubkey,
	isSignature,
	nodeUpdaterAdapter,
	parseManifest,
	readSignatureArgs,
	type SignatureArgs,
	signatureMismatch,
	type UpdaterAdapter,
	type UpdaterError,
	type UpdaterErrorCode,
	type UpdaterFailure,
	type UpdaterOptions,
	updaterPlugin,
	type UpdateManifest,
	verifyEd25519,
} from "./updater";
export {
	createLoggingPlugin,
	isLogLevel,
	loggingPlugin,
	RING_SIZE,
	type LogLevel,
	type LoggingAdapter,
} from "./logging";
export {
	createDeepLink,
	deepLink,
	parseDeepLink,
	type DeepLink,
	type DeepLinkOptions,
	type DeepLinkPlugin,
	type DeepLinkTarget,
} from "./deep-link";
export {
	type AcquireResult,
	type ActivateArgs,
	type ActivatePost,
	type ActivateResult,
	createSingleInstancePlugin,
	type ReleaseResult,
	type SingleInstanceAdapter,
	type SingleInstanceArgs,
	type SingleInstanceOptions,
	singleInstancePlugin,
} from "./single-instance";
export {
	createShellPlugin,
	SHELL_OUTPUT_LINES,
	type ShellCommands,
	type ShellOptions,
	type SpawnOutcome,
} from "./shell";

/**
 * The plugins that need no platform instance. `window` sits outside this list
 * because its adapter needs the running `DarwinPlatform` to read labels from,
 * which only `startApp` has; the runtime appends it before selection, so its
 * name still matches `config.plugins`.
 *
 * `autostart` and `logging` are pure TypeScript and safe to carry everywhere;
 * `clipboard`, `opener`, `os`, `shortcuts`, `shell` and `updater` need an
 * adapter (a pasteboard, an allowlist, a manifest endpoint), so they are
 * exported for an app to register with its own options.
 */
export const corePlugins = [
	fsPlugin,
	dialogPlugin,
	notificationPlugin,
	trayPlugin,
	autostartPlugin,
	loggingPlugin,
] as const satisfies readonly PluginDefinition[];

/** Every core plugin in one registry, ready for `startBridge({ handlers })`. */
export function coreRegistry(): PluginRegistry {
	return new PluginRegistry().register(...corePlugins);
}
