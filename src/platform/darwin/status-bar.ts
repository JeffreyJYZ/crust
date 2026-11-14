/**
 * The macOS menu-bar status item behind `crust:tray`. `NSStatusBar` is in `status_bar/*.c`, compiled at launch by `cc()` the way `index.ts` compiles the shim (no artifact, no Xcode, AppKit and Foundation linked by name); this is the TypeScript half — one opaque `NSStatusItem *` as a number, titles as encoded buffers, clicks routed back from the runtime class whose IMP is the `JSCallback` in `status-bar-item.ts` (`research/cc.md` §5; `site/app/docs/design/page.mdx`).
 * `createStatusBar()` returns exactly `TrayNative`, so it is the darwin adapter with no wrapper. Limits stated, not hidden: one live status bar per process (the runtime class holds a single click IMP and target, so a second live item would share one handler set; destroy frees the slot and reuses the trampoline); the click trampoline is never closed, because freeing it while a menu row still points at the target is a SIGABRT with no JavaScript error; a title longer than `tray_title_capacity()` is applied but not verified, since the readback buffer is bounded and a truncated compare would report a false failure. Parts beside this file: `status-bar-symbols.ts`, `status-bar-ffi.ts`, `status-bar-args.ts`, `status-bar-types.ts`, `status-bar-readback.ts`, `status-bar-item.ts`.
 */

export { statusBar } from "./status-bar-ffi";
export { createStatusBar, currentStatusBar } from "./status-bar-item";
export { STATUS_BAR_SYMBOL_NAMES } from "./status-bar-symbols";
export type { StatusBarShim, StatusBarSymbolName } from "./status-bar-symbols";
export type { StatusBar, StatusBarMenuItem, StatusBarReadback } from "./status-bar-types";
