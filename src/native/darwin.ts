/**
 * `crust/native/darwin` — the macOS adapter factories, as literal static imports.
 *
 * An app that mounts its own native set (a custom menu, notifications, keychain, …) needs the
 * adapter factories; `crust/plugin` exports only plugin factories. Every export here is a static
 * `export … from`, so `bun build --compile` embeds the adapter and a compiled app gets the same
 * factory a dev run gets. Import this subpath explicitly: a compiled bundle embeds exactly one
 * platform's set, and a Windows or Linux build must not pull AppKit code.
 */
export { darwinAccessibilityAdapter } from "../platform/darwin/accessibility.ts";
export { darwinClipboardAdapter } from "../platform/darwin/clipboard.ts";
export { darwinDialogAdapter } from "../platform/darwin/dialog.ts";
export { darwinDockAdapter } from "../platform/darwin/dock.ts";
export { darwinDownloadsAdapter } from "../platform/darwin/downloads.ts";
export { darwinFindAdapter } from "../platform/darwin/find.ts";
export { darwinKeychainAdapter } from "../platform/darwin/keychain.ts";
export { darwinMenuAdapter } from "../platform/darwin/menu-api.ts";
export { darwinNavigationAdapter } from "../platform/darwin/navigation.ts";
export { darwinNotificationAdapter } from "../platform/darwin/notifications.ts";
export { darwinOpenerAdapter } from "../platform/darwin/opener.ts";
export { darwinOsAdapter } from "../platform/darwin/os-info.ts";
export { darwinPowerAdapter } from "../platform/darwin/power.ts";
export { createStatusBar, currentStatusBar } from "../platform/darwin/status-bar.ts";
export { darwinShortcutsAdapter } from "../platform/darwin/shortcuts.ts";
export { mainScreenFrame, listScreens, windowWorkAreas } from "../platform/darwin/screen.ts";
export { darwinThemeAdapter } from "../platform/darwin/theme.ts";
