/**
 * The context-menu half of `crust:menu` on macOS: `popUpMenuPositioningItem:atLocation:inView:` on the key window's content view, over the menu the caller just built in `98_menu_api.c`'s stack (the C lives in `99_menu_context.c`, concatenated into that unit because it shares the stack).
 * **Coordinates.** A page reports CSS pixels from the top-left of its viewport. The content view is unflipped — origin bottom-left, y up — and the webview fills it, so C takes x as-is and flips y about the content view's frame height; nothing is scaled, because one CSS pixel is one point at scale 1.
 */

import type { MenuUnit } from "./menu-api.ts";
import { checked } from "./status-bar-args.ts";

/**
 * Pop the built menu at a page point. It blocks inside AppKit's own tracking loop
 * until the menu is dismissed, which is why no test opens one: the plugin's suite
 * drives a fake adapter and never reaches here.
 */
export function popContextMenu(unit: MenuUnit, x: number, y: number): void {
	checked(unit.symbols.menu_api_popup(x, y), "popUpMenuPositioningItem:");
}
