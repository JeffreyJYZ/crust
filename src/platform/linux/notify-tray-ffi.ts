/**
 * The `bun:ffi` edge for the Linux notification + tray unit: one `cc()` call, its own symbol table,
 * and the two libraries the C resolves at runtime.
 *
 * Kept apart from `shim-ffi.ts` — see `notify-tray-source.ts`. `cc()` links nothing but libc, so a
 * machine without libnotify or GTK still launches: the C answers `shim_notify_missing` with the name
 * of what was absent, and only that namespace refuses.
 */
import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { notifyTraySource } from "./notify-tray-source.ts";

const I32 = FFIType.i32;
const CS = FFIType.cstring;

/**
 * The unit's exports. Every one takes ints or NUL-terminated bytes and answers an int or a static
 * string: no GTK object, no `GError` and no struct crosses this boundary.
 */
export interface LinuxNotifyTrayShim {
	/** 1 when libnotify resolved every entry point; 0 with the gap named by `shim_notify_missing`. */
	shim_notify_load(): number;
	shim_notify_ready(): number;
	shim_notify_missing(): string | null;
	shim_notify_reason(): string | null;
	/**
	 * 0 the daemon accepted it, 2 a symbol did not resolve, 3 libnotify or the daemon refused.
	 * `notify_notification_show` is synchronous, so 0 is the daemon's own answer.
	 */
	shim_notify_post(title: Uint8Array, body: Uint8Array): number;
	/** 1 the last notification was closed, 0 nothing was showing. */
	shim_notify_close(): number;

	/** 1 when GTK resolved every entry point `tray` needs. */
	shim_tray_ready(): number;
	shim_tray_menu(joined: Uint8Array, count: number): number;
	shim_tray_tooltip(text: Uint8Array): number;
	shim_tray_show(): number;
	shim_tray_hide(): number;
	shim_tray_destroy(): number;
	/** The row clicked since the last call, or -1. Cleared as it is read. */
	shim_tray_click(): number;
}

/** One library and one entry point the C resolves, with the package that ships it. */
export interface NotifyTrayPreflightEntry {
	library: string;
	symbol: string;
	pkg: string;
	breaks: string;
}

/** The notification daemon client, and the GTK3 that owns `GtkStatusIcon`. */
export const LIBNOTIFY = "libnotify.so.4";
export const LIBGTK = "libgtk-3.so.0";

const notifyEntry = (symbol: string, breaks: string): NotifyTrayPreflightEntry => ({
	library: LIBNOTIFY,
	symbol,
	pkg: "libnotify4",
	breaks,
});

const gtkEntry = (symbol: string, breaks: string): NotifyTrayPreflightEntry => ({
	library: LIBGTK,
	symbol,
	pkg: "libgtk-3-0",
	breaks,
});

/**
 * Every entry point the C resolves with `shim_sym`. `notify-tray-source.test.ts` reads those calls
 * out of the C and fails when one is missing here, so the table cannot drift into decoration.
 */
export const NOTIFY_TRAY_PREFLIGHT: readonly NotifyTrayPreflightEntry[] = [
	notifyEntry("notify_init", "no notification client, so no notification is ever sent"),
	notifyEntry("notify_notification_new", "notify has no object to hand the daemon"),
	notifyEntry("notify_notification_show", "nothing reaches the notification daemon"),
	notifyEntry("notify_notification_close", "the last notification cannot be dismissed"),
	notifyEntry("g_object_unref", "every notification leaks one GObject"),
	notifyEntry("g_error_free", "every refused notification leaks its GError"),
	gtkEntry("gtk_status_icon_new_from_icon_name", "no status icon, so no tray entry at all"),
	gtkEntry("gtk_status_icon_set_tooltip_text", "tray.setTooltip has nowhere to put the text"),
	gtkEntry("gtk_status_icon_set_visible", "tray.show and tray.hide do nothing"),
	gtkEntry("gtk_menu_new", "tray.setMenu has no menu"),
	gtkEntry("gtk_menu_item_new_with_label", "a stored label never becomes a row"),
	gtkEntry("gtk_menu_shell_append", "the rows are created and never attached"),
	gtkEntry("gtk_widget_show_all", "the menu is built and never shown"),
	gtkEntry("gtk_widget_destroy", "every replaced menu leaks its widget tree"),
	gtkEntry("gtk_menu_popup_at_pointer", "the menu cannot be opened at the cursor (GTK 3.22+)"),
	gtkEntry("g_signal_connect_data", "no row ever reports a click"),
	gtkEntry("g_object_unref", "the status icon is never released"),
];

/** The install line for a machine missing one of the two libraries. */
export const NOTIFY_TRAY_INSTALL_LINE =
	"Debian/Ubuntu: sudo apt install libnotify4 libgtk-3-0 · Fedora: sudo dnf install libnotify gtk3";

/**
 * Materialise the unit and compile it. Content-hashed, so a second launch reuses the same file and
 * TinyCC's per-path cache. `cc()` links only libc, and `linkError` already translates a missing
 * `libc.so` linker script on the platform's own path.
 */
export function compileNotifyTray(): LinuxNotifyTrayShim {
	const hash = createHash("sha256").update(notifyTraySource).digest("hex").slice(0, 16);
	const path = join(tmpdir(), `crust-linux-notify-tray-${hash}.c`);
	if (!existsSync(path)) writeFileSync(path, notifyTraySource);
	const library = cc({
		source: path,
		symbols: {
			shim_notify_load: { args: [], returns: I32 },
			shim_notify_ready: { args: [], returns: I32 },
			shim_notify_missing: { args: [], returns: CS },
			shim_notify_reason: { args: [], returns: CS },
			shim_notify_post: { args: [CS, CS], returns: I32 },
			shim_notify_close: { args: [], returns: I32 },
			shim_tray_ready: { args: [], returns: I32 },
			shim_tray_menu: { args: [CS, I32], returns: I32 },
			shim_tray_tooltip: { args: [CS], returns: I32 },
			shim_tray_show: { args: [], returns: I32 },
			shim_tray_hide: { args: [], returns: I32 },
			shim_tray_destroy: { args: [], returns: I32 },
			shim_tray_click: { args: [], returns: I32 },
		},
	}) as unknown as { symbols: LinuxNotifyTrayShim };
	return library.symbols;
}

let once: LinuxNotifyTrayShim | undefined;

/** Compile at most once per process; `cc()` takes 3–20 ms and the unit lives as long as the app. */
export function notifyTrayShim(): LinuxNotifyTrayShim {
	return (once ??= compileNotifyTray());
}
