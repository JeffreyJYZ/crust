/**
 * Compiling the shipped C shim, once per process. `cc()` compiles C only, and this unit links nothing beyond libc — GTK and WebKit are reached through `dlopen` inside the shim — so there are no `-l` flags and no `-dev` headers are needed. Linking libc still wants the `libc.so` **linker script**, which only the C development package ships: that one package is the whole reason a machine with GTK and WebKitGTK can still fail here, so a `library c not found` from TinyCC is translated by `linkError` instead of escaping raw.
 * Inside a compiled binary `import.meta.dir` is `/$bunfs/root`, where the .c file does not exist, so the source travels in the binary as text and is materialised to a temp file before `cc()` is called.
 */
import { cc } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LinuxBrowserShim } from "./shim-browser.ts";
import type { LinuxDialogShim } from "./dialog-ffi.ts";
import { linkError } from "./preflight.ts";
import { shimSource } from "./shim-source.ts";
import { shimSymbols } from "./shim-symbols.ts";

/**
 * The entry points this shim exports, as JS sees them. Declared by hand because the argument types are the contract a fake has to satisfy: every `cstring` argument is a NUL-terminated byte buffer, never a JavaScript string — bun:ffi throws `a JavaScript string is not valid here` on one, measured against real GTK.
 * The file panels' optional members come from `dialog-ffi.ts`, split out at the line cap and because they are the one namespace that can be absent on an older GTK.
 */
export interface LinuxShim extends LinuxDialogShim, LinuxBrowserShim {
	shim_lib_open(): number;
	shim_lib_error_text(): string | null;
	shim_gtk_init(): number;
	shim_pump(): number;
	shim_window_new(
		title: Uint8Array,
		width: number,
		height: number,
		minWidth: number,
		minHeight: number,
	): number;
	/** The window's positioned container, created on first call and returned again after. */
	shim_window_container(win: bigint): number;
	/** Attach the app's own webview into that container as its main child, which fills the window. */
	shim_window_attach(win: bigint, child: bigint): number;
	shim_window_show(win: bigint): void;
	shim_window_destroy(win: bigint): void;
	shim_window_alive(win: bigint): number;
	shim_webview_new(): number;
	shim_webview_load(web: bigint, url: Uint8Array): number;
	/**
	 * Place a webview at a rectangle in window points inside a window's container: the first call
	 * adds it over the page, a later one moves it. 0 when the container or the GTK entry point is
	 * absent, never a silent no-op that leaves the surface where it was.
	 */
	shim_webview_place(
		box: bigint,
		web: bigint,
		x: number,
		y: number,
		width: number,
		height: number,
	): number;
	/** The allocation one placed widget received: 0 width, 1 height; 0 for a refused read. */
	shim_webview_allocated?(web: bigint, which: number): number;
	/** The size request a placement set, read back from GTK: 0 width, 1 height. */
	shim_webview_requested?(web: bigint, which: number): number;
	/** What GTK holds after a placement: 0 hexpand, 1 vexpand, 2 halign, 3 valign, 4 margin-start. */
	shim_webview_layout?(web: bigint, which: number): number;
	/** The parent GTK holds for a widget, so a proof can attribute the allocation it read. */
	shim_webview_parent?(web: bigint): number;

	/**
	 * The `crust:window` half, every member optional because a fake shim need not carry it and an
	 * older GTK answers 0 rather than failing the launch. `shim_window_api_ready` is the one gate:
	 * when it answers 0, `shim_window_api_missing` names the entry point that was absent.
	 */
	shim_window_api_ready?(): number;
	shim_window_api_missing?(): string | null;
	/** 1 presented, 0 when the window is null or the API is absent. */
	shim_window_present?(win: bigint): number;
	shim_window_set_title?(win: bigint, title: Uint8Array): number;
	/** The title GTK holds, read back after a write; the pointer belongs to the window. */
	shim_window_title?(win: bigint): string | null;
	shim_window_resize?(win: bigint, width: number, height: number): number;
	/** Two ints written: width, height. 0 when GTK has allocated nothing yet. */
	shim_window_size?(win: bigint, out: Int32Array): number;
	/** 1 only on an X11 display: Wayland cannot place or report a toplevel origin. */
	shim_window_placeable?(): number;
	shim_window_move?(win: bigint, x: number, y: number): number;
	/** Two ints written: x, y. 0 off X11, where the origin is not GTK's to know. */
	shim_window_position?(win: bigint, out: Int32Array): number;
	/** The GdkWindowState bitmask, or -1 before the widget has a GdkWindow. */
	shim_window_state?(win: bigint): number;
	/** 0 iconified, 1 maximized, 2 fullscreen; `on` picks the GTK pair. */
	shim_window_flag?(win: bigint, flag: number, on: number): number;
	shim_window_keep_above?(win: bigint, on: number): number;
	shim_window_set_decorated?(win: bigint, on: number): number;
	/** 1 decorated, 0 not, -1 when GTK cannot answer. */
	shim_window_decorated?(win: bigint): number;
	shim_widget_set_opacity?(win: bigint, value: number): number;
	/** -1 when unavailable: 0 is a real opacity. */
	shim_widget_opacity?(win: bigint): number;

	/** 1 when GDK carries every entry point the display list needs; 0 names a GTK too old for it. */
	shim_screen_ready?(): number;
	/** How many displays GDK reports; 0 when it cannot be asked. */
	shim_screen_count(): number;
	/**
	 * Ten doubles for one display, in top-left pixels: frame x/y/w/h, work area x/y/w/h, scale,
	 * then 1 when it is the primary. 1 written, 0 when the index names nothing.
	 */
	shim_screen_info(index: number, out: Float64Array): number;

	/**
	 * The clipboard, the opener and `os.info`, each resolved lazily so an older GTK fails one
	 * namespace by name instead of refusing the launch. `shim_clipboard_read` copies UTF-8 into a
	 * caller buffer and answers the full length — 0 for no text, -1 for no clipboard.
	 */
	shim_clipboard_ready?(): number;
	shim_clipboard_read?(dst: Uint8Array, cap: number): number;
	shim_clipboard_write?(text: Uint8Array, length: number): number;
	shim_opener_ready?(): number;
	shim_opener_open_path?(path: Uint8Array, length: number): number;
	shim_opener_open_url?(url: Uint8Array, length: number): number;
	shim_opener_reason_text?(): string | null;
	shim_os_locale_ready?(): number;
	shim_os_locale?(): string | null;

	/** Resolve libsecret's synchronous API; 1 ready, 0 with a named error in `shim_lib_error_text`. */
	shim_keyring_open(): number;
	/** 1 stored, 0 refused with a named error. */
	shim_keyring_set(service: Uint8Array, account: Uint8Array, secret: Uint8Array): number;
	/**
	 * The secret, or null. `status[0]`: 1 found, 0 not stored, -1 refused, -2 too long.
	 * The returned string is a static C buffer, so no GLib allocation crosses bun:ffi.
	 */
	shim_keyring_get(service: Uint8Array, account: Uint8Array, status: Int32Array): string | null;
	/** 1 removed, 0 nothing stored, -1 refused with a named error. */
	shim_keyring_delete(service: Uint8Array, account: Uint8Array): number;
}

/**
 * The proof's own entry points: what a loaded document, its scripts and a failed
 * load answer with. They are declared apart from `LinuxShim` because the platform
 * never calls them — the smoke does — so a fake backend keeps implementing five
 * methods' worth of symbols rather than eleven. Each one is resolved optionally
 * in C, so an older WebKitGTK fails the proof's step by name instead of refusing
 * to launch every app.
 */
export interface LinuxProofShim {
	/** The loaded document's title, read from the view; null before a document commits. */
	shim_webview_title(web: bigint): string | null;
	/** 0 started, 1 redirected, 2 committed, 3 finished, 4 failed — for this view. */
	shim_webview_load_state(web: bigint): number;
	/** The failing URI, then GLib's message, for a failed load; empty otherwise. */
	shim_webview_load_text(web: bigint): string | null;
	/** Start one script; 0 when the library carries no evaluate_javascript. */
	shim_webview_eval(web: bigint, script: Uint8Array): number;
	/** 0 pending, 1 answered, 2 threw — for the view that asked. */
	shim_webview_eval_state(web: bigint): number;
	/** The answer, or the message a throw carried. */
	shim_webview_eval_text(web: bigint): string | null;
}

/** Compile the embedded shim and declare every entry point it exports. */
function compile(): { symbols: LinuxShim & LinuxProofShim } {
	/** Content-hashed, so a second launch reuses the same file and TinyCC's per-path cache. */
	const hash = createHash("sha256").update(shimSource).digest("hex").slice(0, 16);
	const path = join(tmpdir(), `crust-linux-shim-${hash}.c`);
	if (!existsSync(path)) writeFileSync(path, shimSource);

	const options = { source: path, symbols: shimSymbols };

	try {
		return cc(options) as unknown as {
			symbols: LinuxShim & LinuxProofShim;
		};
	} catch (error) {
		// TinyCC's own message names a library nobody installed and not the package that ships it,
		// so a missing linker script becomes the install line here, where the compile failed.
		const detail = error instanceof Error ? error.message : String(error);
		const translated = linkError(detail);
		if (translated === undefined) throw error;
		throw new Error(`crust: ${translated}`, { cause: error });
	}
}

let shimOnce: { symbols: LinuxShim & LinuxProofShim } | undefined;

/** Compile the shim at most once per process; `cc()` takes 3–20 ms. */
export function shim(): { symbols: LinuxShim & LinuxProofShim } {
	return (shimOnce ??= compile());
}
