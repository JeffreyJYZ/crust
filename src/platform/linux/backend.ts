/**
 * The real backend: every GTK and WebKit call the platform makes, each one guarded so a missing library or a failed allocation becomes a named error instead of a segfault. `LinuxBackend` is the seam a test replaces, which is how the platform is exercised on a machine with no GTK; `createGtkBackend` takes the symbol table the same way, so a fake can record the arguments a real GTK would receive.
 */
import type { WindowOptions } from "@/app.ts";
import { cstring } from "./cstring.ts";
import { INSTALL_LINE } from "./preflight.ts";
import { type LinuxShim, shim } from "./shim-ffi.ts";

/** What a native window is, minus the platform's own handle. */
export interface NativeWindow {
	/** The `GtkWindow *`, as a number because bun:ffi returns pointers as numbers. */
	win: bigint;
	/** The `WebKitWebView *` inside it. */
	web: bigint;
	/** The absolute URL this window was asked to load. */
	url: string;
}

/**
 * Every native call the platform makes, in one seam. The real one is
 * `createGtkBackend`; a test supplies a fake and never loads GTK.
 */
export interface LinuxBackend {
	/** Load the shim and resolve every entry point; throws the preflight text when a library is missing. */
	load(): void;
	/** Run one main-context iteration. Never blocks. */
	iterate(): void;
	/** Build the window and its webview, attach, show, then load `url`. */
	createWindow(options: WindowOptions, url: string): NativeWindow;
	/** Whether GTK still holds this window open — read from C, never from a freed widget. */
	isOpen(win: bigint): boolean;
	/** Destroy a window that is still open. */
	destroy(win: bigint): void;
	/** End the process. */
	quit(): void;
}

/** The window GTK opens when the config gives no size; the darwin default, so both agree. */
const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 760;

/** Build the GTK backend. Nothing loads until `load()` runs. */
export function createGtkBackend(symbolsFor: () => LinuxShim = () => shim().symbols): LinuxBackend {
	let opened = false;

	/**
	 * Open both libraries and resolve every symbol, once. The failure text comes
	 * from C — it names the soname or the exact entry point — and the install line
	 * is appended here so the message is actionable without a second lookup.
	 */
	function open(): void {
		if (opened) return;
		const symbols = symbolsFor();
		if (Number(symbols.shim_lib_open() ?? 0) !== 1) {
			const detail = String(symbols.shim_lib_error_text() ?? "GTK could not load");
			throw new Error(`crust: ${detail}\n  ${INSTALL_LINE}`);
		}
		opened = true;
	}

	return {
		load() {
			open();
			// A null display is the one GTK failure that is not about libraries: it is
			// about the session crust was launched from, so it says that instead.
			if (Number(symbolsFor().shim_gtk_init() ?? 0) !== 1) {
				throw new Error(
					"crust: gtk_init_check failed — no display server (is DISPLAY or WAYLAND_DISPLAY set?)",
				);
			}
		},

		iterate() {
			if (!opened) return;
			symbolsFor().shim_pump();
		},

		createWindow(options, url) {
			// Never call a null entry point: before `load()` every symbol is absent,
			// and an unguarded call is a segfault rather than an error.
			if (!opened)
				throw new Error("crust: createWindow before load — start() must run first");
			const symbols = symbolsFor();
			// A `cstring` argument is a NUL-terminated buffer: bun:ffi throws on a
			// JavaScript string, measured against real GTK on ubuntu-sandbox.
			const win = BigInt(
				Number(
					symbols.shim_window_new(
						cstring(options.title ?? ""),
						options.width ?? DEFAULT_WIDTH,
						options.height ?? DEFAULT_HEIGHT,
						options.minWidth ?? 0,
					) ?? 0,
				),
			);
			if (win === 0n) throw new Error("shim_window_new returned null");
			const web = BigInt(Number(symbols.shim_webview_new() ?? 0));
			if (web === 0n) throw new Error("shim_webview_new returned null");
			if (Number(symbols.shim_window_attach(win, web) ?? 0) !== 1)
				throw new Error("shim_window_attach failed");
			if (Number(symbols.shim_webview_load(web, cstring(url)) ?? 0) !== 1)
				throw new Error(`shim_webview_load failed for ${url}`);
			symbols.shim_window_show(win);
			return { win, web, url };
		},

		isOpen(win) {
			return opened && Number(symbolsFor().shim_window_alive(win) ?? 0) === 1;
		},

		destroy(win) {
			if (opened) symbolsFor().shim_window_destroy(win);
		},

		quit() {
			process.exit(0);
		},
	};
}
