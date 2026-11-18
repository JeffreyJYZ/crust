/**
 * The native half of `crust:clipboard` on Linux: GTK3's `gtk_clipboard_get(GDK_SELECTION_CLIPBOARD)`,
 * `gtk_clipboard_wait_for_text` and `gtk_clipboard_set_text` through the shim the platform already
 * compiles. Nothing but bytes crosses `bun:ffi`: a read copies UTF-8 into a caller-sized buffer and
 * reports the full length, so a long copy is re-read at its exact size instead of being truncated.
 *
 * **Images are refused by name.** `readImage`/`writeImage` would be a GdkPixbuf round trip — decode a
 * PNG into a pixbuf for the set, encode one back for the read — which this shim does not carry. An
 * empty result would read as "the clipboard holds no image", which is a different fact.
 *
 * **A write says `written` when GTK took the request, and the header is honest about why:**
 * `gtk_clipboard_set_text` answers nothing and copies the string, so there is no verdict to read
 * back. A missing clipboard is a throw naming the call, never a silent `written`.
 *
 * UNPROVEN ON REAL GTK: written on macOS, where libgtk-3.so.0 does not exist. The tests drive it
 * through a fake symbol table, so the shape and the two-pass read are proved, not the display.
 */
import type { ClipboardAdapter, ClipboardWriteVerdict } from "@/plugins/clipboard";
import { cstring } from "./cstring.ts";
import { type LinuxShim, shim } from "./shim-ffi.ts";

/** The first buffer size; anything longer is re-read at its exact length. */
export const READ_CHUNK = 64 * 1024;

/** The one sentence a machine without a usable GTK clipboard gets, naming all three calls. */
function notLoaded(symbols: LinuxShim): Error {
	const detail = String(symbols.shim_lib_error_text() ?? "");
	const suffix = detail.length > 0 ? ` (${detail})` : "";
	return new Error(
		`crust: clipboard needs gtk_clipboard_get, gtk_clipboard_set_text and gtk_clipboard_wait_for_text from libgtk-3.so.0, and they did not resolve${suffix}`,
	);
}

/** Build the clipboard adapter. The shim compiles on the first command, never at import. */
export function linuxClipboardAdapter(
	native: () => LinuxShim = () => shim().symbols,
): ClipboardAdapter {
	const readText = (): string => {
		const symbols = native();
		if (Number(symbols.shim_clipboard_ready?.() ?? 0) !== 1) throw notLoaded(symbols);
		let buffer = new Uint8Array(READ_CHUNK);
		let length = Number(symbols.shim_clipboard_read?.(buffer, buffer.length) ?? -1);
		// -1 is "no clipboard to read", which GTK answers when it is not up or too old.
		if (length < 0) throw new Error("crust: gtk_clipboard_get answered no clipboard to read");
		// The buffer was too small, so ask again at the exact size rather than truncating.
		if (length > buffer.length - 1) {
			buffer = new Uint8Array(length + 1);
			length = Number(symbols.shim_clipboard_read?.(buffer, buffer.length) ?? -1);
			if (length < 0)
				throw new Error("crust: gtk_clipboard_get answered no clipboard to read");
		}
		// A clipboard edited between the two calls can still overrun the second buffer; the clamp is
		// a race guard, not the normal path.
		const bytes = Math.min(length, buffer.length - 1);
		return new TextDecoder().decode(buffer.subarray(0, bytes));
	};

	const writeText = (text: string): ClipboardWriteVerdict => {
		const symbols = native();
		if (Number(symbols.shim_clipboard_ready?.() ?? 0) !== 1) throw notLoaded(symbols);
		const bytes = cstring(text);
		const status = Number(symbols.shim_clipboard_write?.(bytes, bytes.length - 1) ?? -1);
		if (status === 1) return "written";
		throw new Error("crust: gtk_clipboard_get answered no clipboard to write to");
	};

	return {
		readText,
		writeText,
		// Refused by name: see the header. An empty result here would be a lie a page cannot detect.
		readImage: (): Uint8Array | null => {
			throw new Error(
				"crust: clipboard.readImage needs a GdkPixbuf encode of the selection, which this shim does not carry — the GTK half copies text only",
			);
		},
		writeImage: (): ClipboardWriteVerdict => {
			throw new Error(
				"crust: clipboard.writeImage needs a GdkPixbuf decode of the PNG and gtk_clipboard_set_image, which this shim does not carry — the GTK half copies text only",
			);
		},
	};
}
