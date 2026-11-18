/**
 * The native half of `crust:clipboard` on Windows: `OpenClipboard` / `GetClipboardData(CF_UNICODETEXT)`
 * / `SetClipboardData` through the shim the running `WindowsPlatform` compiled. Nothing but bytes
 * crosses `bun:ffi`: a read copies UTF-8 into a caller-sized buffer and reports the full length, so a
 * long copy is re-read at its exact size instead of being silently truncated.
 *
 * **Text is the whole of what this carries.** PNG would need `CF_DIBV5` plus a GDI+ encode and
 * decode, which is a second library and a second format; `readImage`/`writeImage` therefore refuse by
 * name instead of answering empty bytes that read as "the clipboard holds no image" — a fake success
 * is the failure mode this framework is trying to remove, not add.
 *
 * UNPROVEN ON WINDOWS: written on macOS, where no Win32 symbol exists. The tests drive the adapter
 * through the fake shim, so what is proved is the shape and the two-pass read, not user32.
 */
import { ptr } from "bun:ffi";
import type { ClipboardAdapter, ClipboardWriteVerdict } from "@/plugins/clipboard";
import { activeWindowsShim, requireWindowsShim } from "./active-shim.ts";
import type { WindowsShim } from "./backend.ts";
import { cstring } from "./cstring.ts";

/** The first buffer size; anything longer is re-read at its exact length. */
export const READ_CHUNK = 64 * 1024;

/** `OpenClipboard` refusing is a real state (another process holds it), and it is not "empty". */
const UNOPENED =
	"crust: OpenClipboard refused, so the clipboard could not be read — another process may hold it";

/** `1` written, `-1` the clipboard could not be opened — the C status as the plugin's verdict. */
function verdict(status: number): ClipboardWriteVerdict {
	if (status === 1) return "written";
	if (status === -1) return "missing";
	return "refused";
}

/** Build the clipboard adapter. The shim is asked per call, never held at construction. */
export function windowsClipboardAdapter(
	native: () => WindowsShim | undefined = activeWindowsShim,
): ClipboardAdapter {
	const readText = (): string => {
		const shim = requireWindowsShim(native);
		if (Number(shim.shim_clipboard_ready()) !== 1) {
			throw new Error(
				"crust: the Win32 clipboard entry points did not resolve on this machine, so no text can be read",
			);
		}
		let buffer = new Uint8Array(READ_CHUNK);
		let length = Number(shim.shim_clipboard_read(ptr(buffer), buffer.length));
		if (length < 0) throw new Error(UNOPENED);
		// The buffer was too small, so ask again at the exact size rather than truncating.
		if (length > buffer.length - 1) {
			buffer = new Uint8Array(length + 1);
			length = Number(shim.shim_clipboard_read(ptr(buffer), buffer.length));
			if (length < 0) throw new Error(UNOPENED);
		}
		// A clipboard edited between the two calls can still overrun the second buffer; the clamp is
		// a race guard, not the normal path.
		const bytes = Math.min(length, buffer.length - 1);
		return new TextDecoder().decode(buffer.subarray(0, bytes));
	};

	const writeText = (text: string): ClipboardWriteVerdict => {
		const shim = requireWindowsShim(native);
		// The NUL keeps the buffer a C string; the length handed over excludes it, because
		// `SetClipboardData` takes the text's own length and adds its own terminator.
		const bytes = cstring(text);
		const status = Number(shim.shim_clipboard_write(bytes, bytes.length - 1));
		// -1 is "the clipboard could not be opened", which is not a write the clipboard refused:
		// answering `missing` here would reach the page as a missing pasteboard.
		if (status < 0) throw new Error(UNOPENED);
		return verdict(status);
	};

	return {
		readText,
		writeText,
		// Refused by name: see the header. An empty result here would be a lie a page cannot detect.
		readImage: (): Uint8Array | null => {
			throw new Error(
				"crust: clipboard.readImage needs CF_DIBV5 and a GDI+ encode of PNG, which this shim does not bind — the Win32 half carries text only",
			);
		},
		writeImage: (): ClipboardWriteVerdict => {
			throw new Error(
				"crust: clipboard.writeImage needs a GDI+ PNG decode into CF_DIBV5, which this shim does not bind — the Win32 half carries text only",
			);
		},
	};
}
