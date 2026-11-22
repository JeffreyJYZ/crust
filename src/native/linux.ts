/**
 * `crust/native/linux` — the Linux adapter factories, as literal static imports.
 *
 * Every export comes from `../platform/linux/*`; nothing here touches AppKit or Win32. A Linux
 * build that imports this subpath embeds only the GTK/WebKitGTK half, so a compiled bundle carries
 * no other platform's FFI. A Linux app that mounts its own native set imports from here, never
 * from a relative path into `node_modules/crust/src/platform/...` — that path cannot survive
 * `bun build --compile`, where the package root is `/$bunfs/root`.
 */
export { linuxBrowserAdapter } from "../platform/linux/browser.ts";
export { linuxClipboardAdapter } from "../platform/linux/clipboard.ts";
export { linuxDialogAdapter } from "../platform/linux/dialog.ts";
export { linuxKeychainAdapter } from "../platform/linux/keychain.ts";
export { linuxNotificationAdapter } from "../platform/linux/notification-adapter.ts";
export { linuxOpenerAdapter } from "../platform/linux/opener.ts";
export { linuxOsAdapter } from "../platform/linux/os-info.ts";
export { linuxScreenAdapter, linuxWindowWorkAreas } from "../platform/linux/screen.ts";
export { linuxTrayAdapter } from "../platform/linux/tray-adapter.ts";
export { linuxWindowAdapter } from "../platform/linux/window-adapter.ts";
