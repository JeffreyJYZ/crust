/**
 * The plugins whose behaviour comes from a native platform half: the pasteboard, the shell
 * opener, the OS facts, key dispatch, the window and its geometry, the menu bar, appearance,
 * the Dock, power sources and the accessibility tree.
 *
 * Re-exports only, so `index.ts` stays a map of the plugin surface rather than the surface itself.
 */

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
export { createClipboardPlugin, clipboardPlugin, type ClipboardAdapter } from "./clipboard";
export { createOpenerPlugin, openerPlugin, type OpenerAdapter } from "./opener";
export { createOsPlugin, osPlugin, type OsAdapter } from "./os";
export { createShortcutsPlugin, shortcutsPlugin, type ShortcutAdapter } from "./shortcuts";
export { createWindowStatePlugin, windowStatePlugin } from "./window-persist";
export { createPositionerPlugin, positionerPlugin } from "./positioner";
export {
	createScreenPlugin,
	SCREEN_COMMANDS,
	screenPlugin,
	type ScreenAdapter,
	type ScreenBounds,
	type ScreenFailure,
	type ScreenListResult,
	type ScreenPrimaryResult,
	type ScreenRecord,
} from "./screen";
export { createMenuPlugin, menuPlugin, type MenuAdapter } from "./menu";
export {
	type Appearance,
	type AppearancePreference,
	type AppearanceSource,
	createThemePlugin,
	THEME_CHANGED,
	type ThemeAdapter,
	type ThemePlugin,
	type ThemeState,
	themePlugin,
} from "./theme";
export { createDockPlugin, dockPlugin, type DockAdapter } from "./dock";
export { createPowerPlugin, POWER_COMMANDS, powerPlugin, type PowerAdapter } from "./power";
export {
	createAccessibilityPlugin,
	accessibilityPlugin,
	type AccessibilityAdapter,
} from "./accessibility";
export {
	createNavigationPlugin,
	navigationPlugin,
	type NavigationAdapter,
	type NavigationEventKind,
	type NavigationEventPayload,
	type NavigationFailure,
	type NavigationInstall,
	type NavigationState,
} from "./navigation";
export {
	createFindInPagePlugin,
	findinpagePlugin,
	type FindAdapter,
	type FindFailure,
	type FindOutcome,
	type FindQuery,
} from "./findinpage";
export {
	createNetworkPlugin,
	NETWORK_LOG_LIMIT,
	NETWORK_SCHEME,
	networkPlugin,
	type NetworkAction,
	type NetworkAdapter,
	type NetworkInstall,
	type NetworkLogEntry,
	type NetworkRule,
	type NetworkStatus,
} from "./network";
