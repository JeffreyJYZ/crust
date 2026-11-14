/**
 * The macOS menu-bar status item behind `crust:tray`.
 *
 * `NSStatusBar` lives in `status_bar/*.c`, compiled at launch by `cc()` with the
 * same route `index.ts` uses for the shim: no artifact, no Xcode, AppKit and
 * Foundation linked by name. This module is the TypeScript half — one opaque
 * `NSStatusItem *` held as a number, titles passed as encoded buffers, and the
 * clicked menu row routed back from the Objective-C runtime class whose IMP is
 * the `JSCallback` in `status-bar-item.ts` (research/cc.md §5, DESIGN.md §2 trap 3).
 *
 * `createStatusBar()` returns exactly the `TrayNative` shape, so it is the
 * darwin adapter without a second wrapper: `createTrayPlugin(createStatusBar())`.
 * That is how `runtime.ts` wires it on macOS (`nativePlugins`).
 *
 * Limits this module states instead of hiding:
 *
 *   - One live status bar per process. `createStatusBar()` throws while another
 *     is alive, because the runtime class holds a single click IMP and a single
 *     target instance; every menu row of every live item would otherwise share
 *     one handler set. Destroying frees the slot, and the same click trampoline
 *     is reused, so repeated create/destroy does not allocate per cycle.
 *   - The click trampoline is never closed. Freeing it while an AppKit menu row
 *     still points at the target is a SIGABRT with no JavaScript error, so it
 *     lives for the process lifetime.
 *   - A title longer than `tray_title_capacity()` bytes is applied but not
 *     verified: the readback buffer is bounded, and comparing a truncated
 *     string would report a false failure.
 *
 * This file is the public surface; the work is split by responsibility beside
 * it — `status-bar-symbols.ts` (the ABI), `status-bar-ffi.ts` (compile and the
 * concatenated C unit), `status-bar-args.ts` (marshalling), `status-bar-types.ts`
 * (the shapes), `status-bar-readback.ts` (AppKit's claims) and
 * `status-bar-item.ts` (the live item and the click route). Every name that was
 * exported before is still exported here.
 */

export { statusBar } from "./status-bar-ffi";
export { createStatusBar, currentStatusBar } from "./status-bar-item";
export { STATUS_BAR_SYMBOL_NAMES } from "./status-bar-symbols";
export type { StatusBarShim, StatusBarSymbolName } from "./status-bar-symbols";
export type { StatusBar, StatusBarMenuItem, StatusBarReadback } from "./status-bar-types";
