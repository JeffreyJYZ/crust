/**
 * `crust/native` — the current platform's native adapter factories, as literal static imports.
 *
 * Why this entry exists: an app that mounts its own native set (a custom menu, notifications,
 * keychain, …) needs the adapter factories, and `crust/plugin` exports only the plugin factories.
 * Reaching into `node_modules/crust/src/platform/...` works in a dev run, and the older
 * `import.meta.resolve("crust")` trick never survives `bun build --compile`: inside a binary the
 * package root is `/$bunfs/root`, where no `package.json` exists, so resolution throws and a
 * loader that swallows it answers `undefined` for every adapter. This module is the supported
 * path: every export below is a static `export … from`, so the bundler embeds the adapter and a
 * compiled app gets the same factories a dev run gets.
 *
 * The exports are the macOS (darwin) set: a `bun build --compile` binary is platform-specific,
 * so the build embeds exactly the adapters it can run. A non-macOS app must not import this entry —
 * its AppKit-backed modules cannot load there.
 */
export { darwinAccessibilityAdapter } from "./platform/darwin/accessibility.ts";
export { darwinClipboardAdapter } from "./platform/darwin/clipboard.ts";
export { darwinDialogAdapter } from "./platform/darwin/dialog.ts";
export { darwinDockAdapter } from "./platform/darwin/dock.ts";
export { darwinDownloadsAdapter } from "./platform/darwin/downloads.ts";
export { darwinFindAdapter } from "./platform/darwin/find.ts";
export { darwinKeychainAdapter } from "./platform/darwin/keychain.ts";
export { darwinMenuAdapter } from "./platform/darwin/menu-api.ts";
export { darwinNavigationAdapter } from "./platform/darwin/navigation.ts";
export { darwinNotificationAdapter } from "./platform/darwin/notifications.ts";
export { darwinOpenerAdapter } from "./platform/darwin/opener.ts";
export { darwinOsAdapter } from "./platform/darwin/os-info.ts";
export { darwinPowerAdapter } from "./platform/darwin/power.ts";
export { createStatusBar, currentStatusBar } from "./platform/darwin/status-bar.ts";
export { darwinShortcutsAdapter } from "./platform/darwin/shortcuts.ts";
export { mainScreenFrame, listScreens, windowWorkAreas } from "./platform/darwin/screen.ts";
export { darwinThemeAdapter } from "./platform/darwin/theme.ts";
