/**
 * `crust/native/windows` — the Windows adapter factories, as literal static imports.
 *
 * Every export comes from `../platform/windows/*`; nothing here touches AppKit or GTK. A Windows
 * build that imports this subpath embeds only the Win32 half, so a compiled bundle carries no
 * other platform's FFI. A Windows app that mounts its own native set imports from here, never
 * from a relative path into `node_modules/crust/src/platform/...` — that path cannot survive
 * `bun build --compile`, where the package root is `/$bunfs/root`.
 */
export { windowsBrowserAdapter } from "../platform/windows/browser.ts";
export { windowsClipboardAdapter } from "../platform/windows/clipboard.ts";
export { windowsDialogAdapter } from "../platform/windows/dialog.ts";
export { windowsKeychainAdapter } from "../platform/windows/keychain.ts";
export { windowsNotificationAdapter } from "../platform/windows/notification-adapter.ts";
export { windowsOpenerAdapter } from "../platform/windows/opener.ts";
export { windowsOsAdapter } from "../platform/windows/os-info.ts";
export { windowsScreenAdapter, windowsWindowWorkAreas } from "../platform/windows/screen.ts";
export { windowsTrayAdapter } from "../platform/windows/tray-adapter.ts";
export { windowsWindowAdapter } from "../platform/windows/window-adapter.ts";
