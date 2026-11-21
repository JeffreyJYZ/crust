/**
 * The fake's namespace members — clipboard, opener, `os.info` and the file panels — split out of
 * `fake-shim.ts` when that table passed the line cap, and along the same seam `backend-namespaces.ts`
 * splits the real interface.
 *
 * Each answers from `FakeOptions` so one fake covers a working clipboard and a refused one; the file
 * panels are stubs, because they belong to the dialog lane and only need the symbol table complete.
 */
import type { WindowsShim } from "./backend.ts";
import type { FakeOptions } from "./fake-backend.ts";
import { at, encoder, text } from "./fake-bytes.ts";

export type FakeNamespaceShim = Pick<
	WindowsShim,
	| "shim_clipboard_ready"
	| "shim_clipboard_read"
	| "shim_clipboard_write"
	| "shim_opener_open_path"
	| "shim_opener_open_url"
	| "shim_opener_reveal"
	| "shim_opener_reason_text"
	| "shim_os_version"
	| "shim_os_locale"
	| "shim_os_uptime"
	| "shim_dialog_open"
	| "shim_dialog_save"
	| "shim_dialog_count"
	| "shim_dialog_path"
	| "shim_dialog_error"
	| "shim_dialog_missing"
	| "shim_preview_ready"
	| "shim_preview_show"
	| "shim_preview_hide"
	| "shim_preview_size"
	| "shim_preview_hwnd"
	| "shim_preview_step"
	| "shim_preview_hresult"
>;

export function fakeNamespaces(calls: string[], options: FakeOptions = {}): FakeNamespaceShim {
	return {
		shim_clipboard_ready: () => options.clipboardReady ?? 1,
		shim_clipboard_read: (dst, cap) => {
			const bytes = encoder.encode(options.clipboard ?? "");
			calls.push(`clipboard_read:${options.clipboard ?? ""}`);
			if (options.clipboardRead !== undefined) return options.clipboardRead;
			const room = Math.max(0, Number(cap) - 1);
			const take = Math.min(bytes.length, room);
			if (take > 0) at(Number(dst), take).set(bytes.subarray(0, take));
			// The terminator: a cstring argument read back needs one inside the buffer.
			if (room > 0) at(Number(dst) + take, 1)[0] = 0;
			return bytes.length;
		},
		shim_clipboard_write: (bytes) => {
			calls.push(`clipboard_write:${text(bytes)}`);
			return options.clipboardWrite ?? 1;
		},
		shim_opener_open_path: (bytes) => {
			calls.push(`opener_path:${text(bytes)}`);
			return options.openerResult ?? 1;
		},
		shim_opener_open_url: (bytes) => {
			calls.push(`opener_url:${text(bytes)}`);
			return options.openerResult ?? 1;
		},
		shim_opener_reveal: (bytes) => {
			calls.push(`opener_reveal:${text(bytes)}`);
			return options.openerResult ?? 1;
		},
		shim_opener_reason_text: () => options.openerReason ?? "",
		shim_os_version: (component) =>
			options.osVersion?.[Number(component)] ?? [10, 0, 22631][Number(component)] ?? -1,
		shim_os_locale: () => options.osLocale ?? "en-GB",
		shim_os_uptime: () => options.osUptime ?? 4321.5,

		// The file panels belong to the dialog lane: these stubs keep the symbol table complete so
		// the tree typechecks, and that lane replaces them with its own behaviour.
		shim_dialog_open: () => {
			calls.push("dialog_open");
			return 0;
		},
		shim_dialog_save: () => {
			calls.push("dialog_save");
			return 0;
		},
		shim_dialog_count: () => 0,
		shim_dialog_path: () => "",
		shim_dialog_error: () => 0,
		shim_dialog_missing: () => "",

		// The preview host is stubbed the same way: `no-handler` is the honest default for a fake with
		// no COM, and a test that wants a shown preview builds its own six-member fake.
		shim_preview_ready: () => 1,
		shim_preview_show: () => {
			calls.push("preview_show");
			return 1;
		},
		shim_preview_hide: () => {
			calls.push("preview_hide");
			return 1;
		},
		shim_preview_size: () => 1,
		shim_preview_hwnd: () => 0,
		shim_preview_step: () => 0,
		shim_preview_hresult: () => 0,
	};
}
