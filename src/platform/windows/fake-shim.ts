/**
 * The symbol table a test drives: every entry of `WindowsShim`, recording into a call log instead of
 * reaching Windows. Split from `fake-backend.ts` when that file outgrew the line cap, and exported on
 * its own so a test that only needs to record a few arguments can spread it and override those.
 * The style members and the namespace members are spread in from their own modules.
 */
import type { WindowsShim } from "./backend.ts";
import type { FakeOptions } from "./fake-backend.ts";
import { text } from "./fake-bytes.ts";
import { fakeNamespaces } from "./fake-namespaces.ts";
import { fakeWindowStyle } from "./fake-style.ts";
import { fakeWebView } from "./fake-webview.ts";

/**
 * The shim a test drives, with its call log. Exported on its own so a test that only needs to record
 * a few arguments can spread this and override those, instead of restating every method.
 */
export function fakeShim(
	options: FakeOptions = {},
	calls: string[] = [],
	hwnds: number[] = [],
	open: Set<number> = new Set(),
): WindowsShim {
	let next = 100;
	// The frame the fake starts at, and what `set_frame` moves. One window's worth is enough: every
	// test here drives a single label, and a per-hwnd map would only restate the registry.
	// A minimised window reports the iconic off-screen rect and a maximised one the whole monitor,
	// because that is what `GetWindowRect` answers in those states — the two shapes the adapter has to
	// avoid reporting as a real frame.
	const frame = options.minimized
		? [-32000, -32000, 160, 28]
		: options.maximized
			? [0, 0, 1920, 1080]
			: [40, 60, 900, 640];
	// `WINDOWPLACEMENT.rcNormalPosition`. A move of a window in its normal state moves this too, which
	// is what Win32 does; a maximised window keeps it, which is the whole reason it is the rect worth
	// saving.
	const normal = [40, 60, 900, 640];

	return {
		// The style, opacity, placement and pointer members, which keep a record per hwnd rather
		// than sharing `frame` below — see `fake-style.ts`.
		...fakeWindowStyle(calls, options),
		// The clipboard, opener, `os.info` and file-panel members — see `fake-namespaces.ts`.
		...fakeNamespaces(calls, options),
		shim_win32_ready: () => {
			calls.push("win32_ready");
			return options.win32Ready ?? 1;
		},
		shim_com_init: () => {
			calls.push("com_init");
			return options.comInit ?? 0;
		},
		shim_last_error: () => 87,
		shim_register_class: (name) => {
			calls.push(`register_class:${text(name)}`);
			return options.classAtom ?? 1;
		},
		shim_pump: () => {
			calls.push("pump");
			return 0;
		},
		shim_post_quit: () => {
			calls.push("post_quit");
		},
		// The one message a test can queue itself: the pump proof posts it and then asserts a dispatch.
		shim_window_post_null: (hwnd) => {
			calls.push(`post_null:${Number(hwnd)}`);
			return open.has(Number(hwnd)) ? 1 : 0;
		},
		shim_window_new: (title, width, height, className, activate = 1) => {
			const passive = Number(activate) === 0 ? ":passive" : "";
			calls.push(`window_new:${text(title)}:${width}x${height}:${text(className)}${passive}`);
			if (options.failWindow) return 0;
			const hwnd = next++;
			hwnds.push(hwnd);
			open.add(hwnd);
			return hwnd;
		},
		shim_window_is_open: (hwnd) => (open.has(Number(hwnd)) ? 1 : 0),
		shim_window_set_title: (_hwnd, title) => {
			calls.push(`set_title:${text(title)}`);
			return 1;
		},
		shim_window_destroy: (hwnd) => {
			calls.push("window_destroy");
			open.delete(Number(hwnd));
			return 1;
		},
		shim_window_set_min: (_hwnd, width, height) => {
			calls.push(`min:${Number(width)}x${Number(height)}`);
		},
		shim_window_client_num: (_hwnd, component) => (component === 2 ? 800 : 600),
		// A frame the tests can move: `set_frame` records the numbers and `shim_window_frame` writes
		// them back, so a setSize/getSize round trip is provable without a window. `failFrameRead` is
		// the closed-handle case: `GetWindowRect` failed, which is 0 rather than a 0x0 frame.
		shim_window_frame: (_hwnd, out) => {
			if (options.failFrameRead) return 0;
			out.set(frame);
			return 1;
		},
		// `rcNormalPosition`. Starts as the same rect and is left alone by `set_frame`, so a test can
		// tell "the window moved" from "the restore rect moved".
		shim_window_normal_frame: (_hwnd, out) => {
			if (options.failFrameRead) return 0;
			out.set(normal);
			return 1;
		},
		shim_window_set_frame: (_hwnd, x, y, width, height) => {
			calls.push(`set_frame:${Number(x)},${Number(y)},${Number(width)},${Number(height)}`);
			frame.splice(0, frame.length, Number(x), Number(y), Number(width), Number(height));
			// A window in its normal or minimised state carries its own rect as the restore rect — a
			// minimised window can still be resized, and the new size is what it returns to. A
			// maximised one keeps the restore rect it had before it was zoomed.
			if (!options.maximized)
				normal.splice(
					0,
					normal.length,
					Number(x),
					Number(y),
					Number(width),
					Number(height),
				);
			return options.failFrame ? 0 : 1;
		},
		shim_window_show: (_hwnd, verb) => {
			calls.push(`show:${Number(verb)}`);
			return 1;
		},
		shim_window_is_minimized: () => (options.minimized ? 1 : 0),
		shim_window_is_maximized: () => (options.maximized ? 1 : 0),
		shim_window_focus: () => {
			calls.push("focus");
			return options.failFocus ? 0 : 1;
		},
		shim_window_set_material: (hwnd, kind) => {
			calls.push(`material:${Number(hwnd)}:${kind}`);
			return options.materialResult ?? 0;
		},
		shim_screen_count: () => 0,
		shim_screen_info: () => 0,
		// The WebView2 members — see `fake-webview.ts`.
		...fakeWebView(calls, options),
	};
}
