/**
 * The ABI `status_bar/*.c` publishes, as TypeScript types — separated from the compiler so the symbol list is readable on its own: the concatenated unit must export exactly these names, and `tray.test.ts` asserts the library has no others.
 */

/** Every symbol `status_bar/*.c` exports, in the order the unit declares them. */
export const STATUS_BAR_SYMBOL_NAMES = [
	"tray_abi",
	"tray_create",
	"tray_set_title",
	"tray_title_copy",
	"tray_title_capacity",
	"tray_set_visible",
	"tray_item_visible",
	"tray_item_length",
	"tray_button_window",
	"tray_button_window_visible",
	"tray_button_window_frame",
	"tray_button_window_occlusion",
	"tray_button_window_active_space",
	"tray_menu_begin",
	"tray_menu_add",
	"tray_menu_end",
	"tray_menu_clear",
	"tray_menu_count",
	"tray_menu_activate",
	"tray_item_index",
	"tray_destroy",
] as const;

export type StatusBarSymbolName = (typeof STATUS_BAR_SYMBOL_NAMES)[number];

// `bun:ffi` types a pointer as a nominal number and a `ptr` argument as
// Pointer|TypedArray|bigint, while the runtime value here is always a plain
// number. One cast at compile() keeps every call site honest numbers.
export type LooseArg = number | bigint | string | null | undefined | ArrayBufferView;

export type LooseSymbol = (...args: LooseArg[]) => number | bigint | string | null | undefined;

export interface StatusBarShim {
	symbols: Record<StatusBarSymbolName, LooseSymbol>;
}
