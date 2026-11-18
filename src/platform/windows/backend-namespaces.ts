/**
 * The shim's namespace members — clipboard, opener, `os.info` and the file panels — split out of
 * `backend.ts` when that interface passed the line cap.
 *
 * They are here rather than in one file because each belongs to a plugin namespace of its own: a
 * machine missing comdlg32 refuses `dialog` and launches the app, and the same is true of the
 * clipboard and the shell. `WindowsShim` extends this, so every caller still takes one type.
 */

export interface WindowsNamespaceShim {
	/**
	 * The clipboard, over `OpenClipboard`/`GetClipboardData(CF_UNICODETEXT)`. `ready` answers 1 when
	 * every entry point resolved; `read` copies UTF-8 into a caller buffer and answers the length the
	 * whole string needs — 0 for no text, -1 when the clipboard could not be opened — so a long copy
	 * is re-read at its exact size rather than truncated. `write` is 1 written, 0 refused, -1 the
	 * clipboard could not be opened.
	 */
	shim_clipboard_ready(): number;
	shim_clipboard_read(dst: number, cap: number): number;
	shim_clipboard_write(bytes: Uint8Array, length: number): number;

	/**
	 * The opener, over `ShellExecuteW("open", …)`. 1 when the shell took the request, 0 when it
	 * answered a `SE_ERR_*` code at or below 32 — which is *not* an HRESULT, and
	 * `shim_opener_reason_text` carries the step and the number.
	 */
	shim_opener_open_path(bytes: Uint8Array, length: number): number;
	shim_opener_open_url(bytes: Uint8Array, length: number): number;
	shim_opener_reveal(bytes: Uint8Array, length: number): number;
	shim_opener_reason_text(): string | null;

	/**
	 * `os.info`'s three native facts: component 0/1/2 of `RtlGetVersion` (major, minor, build; -1
	 * when unreadable), the BCP-47 locale `GetUserDefaultLocaleName` writes, and seconds since boot
	 * from `GetTickCount64`.
	 */
	shim_os_version(component: number): number;
	shim_os_locale(): string | null;
	shim_os_uptime(): number;

	/**
	 * The file panels: comdlg32/shell32, resolved on the first pick. Status is 1 picked, 0 the human
	 * cancelled, -2 an entry point is absent (`shim_dialog_missing` names it), -3 comdlg32 refused
	 * with the code `shim_dialog_error` holds. `owner` is the HWND the panel is modal to, or 0.
	 */
	shim_dialog_open(
		title: Uint8Array,
		filters: Uint8Array,
		multiple: number,
		directory: number,
		owner: number,
	): number;
	shim_dialog_save(
		title: Uint8Array,
		suggested: Uint8Array,
		filters: Uint8Array,
		owner: number,
	): number;
	/** How many paths the last pick answered with; 0 after a cancel. */
	shim_dialog_count(): number;
	/** One path as UTF-8, or an empty string for an index outside the answer. */
	shim_dialog_path(index: number): string | null;
	/** `CommDlgExtendedError` from the last refused call, or 0. */
	shim_dialog_error(): number;
	/** The comdlg32 or shell32 entry point that did not resolve; empty when the panels are usable. */
	shim_dialog_missing(): string | null;
}
