/**
 * The fake symbol table the three core-namespace tests drive: every answer is stated by the test, so
 * what runs on this machine is the adapter's own arithmetic rather than GTK.
 *
 * `shim_clipboard_read` writes into the caller's buffer the way the C half does — the buffer arrives
 * as a `Uint8Array` because the FFI declaration is a pointer — which is what makes the two-pass read
 * provable without a display server.
 */
import type { LinuxShim } from "./shim-ffi.ts";

export interface CoreFakeOptions {
	/** The text the fake clipboard holds. */
	clipboard?: string;
	/** What `shim_clipboard_ready` answers; 0 is a GTK without the clipboard entry points. */
	clipboardReady?: number;
	/** What `shim_clipboard_write` answers; -1 is no clipboard to write to. */
	clipboardWrite?: number;
	/** What `shim_clipboard_read` answers instead of a length, to fake a missing clipboard. */
	clipboardRead?: number;
	/** What the opener calls answer: 1 handed to GIO, 0 refused. */
	openerResult?: number;
	/** The reason `shim_opener_reason_text` carries after a refusal. */
	openerReason?: string;
	/** What `g_get_language_names` answers through the shim. */
	locale?: string;
	/** What `shim_os_locale_ready` answers. */
	localeReady?: number;
	/** What `shim_lib_error_text` answers, as a failed `dlopen` would. */
	errorText?: string;
	/** Every call the adapter made, in order, as `name:detail`. */
	calls?: string[];
}

/** The symbol table, with the arms this layer calls and nothing else. */
export function fakeCoreShim(options: CoreFakeOptions = {}): LinuxShim {
	const calls = options.calls ?? [];
	const encoder = new TextEncoder();
	return {
		shim_lib_error_text: () => options.errorText ?? "",
		shim_clipboard_ready: () => options.clipboardReady ?? 1,
		shim_clipboard_read: (dst: Uint8Array, cap: number) => {
			const bytes = encoder.encode(options.clipboard ?? "");
			calls.push(`clipboard_read:${options.clipboard ?? ""}`);
			if (options.clipboardRead !== undefined) return options.clipboardRead;
			const take = Math.min(bytes.length, Math.max(0, Number(cap) - 1));
			dst.set(bytes.subarray(0, take));
			if (Number(cap) > 0) dst[take] = 0;
			return bytes.length;
		},
		shim_clipboard_write: (text: Uint8Array, length: number) => {
			calls.push(`clipboard_write:${Buffer.from(text).toString("utf8").replace(/\0$/, "")}`);
			// The length is the text without its terminator, which is the contract the C half has.
			if (length < 0) return -1;
			return options.clipboardWrite ?? 1;
		},
		shim_opener_ready: () => 1,
		shim_opener_open_path: (path: Uint8Array) => {
			calls.push(`opener_path:${Buffer.from(path).toString("utf8").replace(/\0$/, "")}`);
			return options.openerResult ?? 1;
		},
		shim_opener_open_url: (url: Uint8Array) => {
			calls.push(`opener_url:${Buffer.from(url).toString("utf8").replace(/\0$/, "")}`);
			return options.openerResult ?? 1;
		},
		shim_opener_reason_text: () => options.openerReason ?? "",
		shim_os_locale_ready: () => options.localeReady ?? 1,
		shim_os_locale: () => options.locale ?? "en_GB.UTF-8",
	} as unknown as LinuxShim;
}
