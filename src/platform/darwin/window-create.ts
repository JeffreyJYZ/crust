/**
 * Build the window with `initWithContentRect:` on the C stack (a bare `[[NSWindow alloc] init]` aborts from AppKit's event thread), add the webview, pin it with Auto Layout, order front, then load the URL inside C.
 * Kept away from `DarwinPlatform` so construction and tracking read separately; activation is passed in because it is the one platform fact this needs.
 */
import type { WindowOptions } from "@/app.ts";
import { shim } from "./index.ts";
import { allocInit, cstr, ptrValue, S } from "./objc.ts";
import type { NativeWindowPointers } from "./windows.ts";

export function createNativeWindow(
	label: string,
	options: WindowOptions,
	activate: () => void,
): NativeWindowPointers {
	const width = options.width ?? 1100;
	const height = options.height ?? 760;
	// titled(1) | closable(2) | miniaturizable(4) | resizable(8)
	const win = Number(shim().symbols.shim_window_new(120, 120, width, height, 15n, 2n, 0));
	if (!win) throw new Error("shim_window_new returned null");
	// minWidth was validated and carried but read by nobody; it lands here, where
	// the window exists and the size is still ours to constrain.
	if (options.minWidth !== undefined) {
		shim().symbols.shim_window_set_min_size(win, options.minWidth, height);
	}

	// A closed window must stay addressable: `-close` does not release it,
	// and the liveness read afterwards needs the object alive. Released, the
	// pointer would dangle and the next guarded send would fault.
	S.vb1(win, "setReleasedWhenClosed:", 0);

	const web = allocInit("WKWebView");
	if (!web) throw new Error("[[WKWebView alloc] init] returned null");

	const content = S.p0(win, "contentView");
	if (!content) throw new Error("-[NSWindow contentView] returned null");
	S.v1(content, "addSubview:", web);
	// Layer-backed content. Without this a window's backing can be torn down when the app
	// resigns active, and the page keeps running while its pixels disappear — measured with
	// a heartbeat page: six invokes arrived while the window was empty.
	S.vb1(content, "setWantsLayer:", 1);
	S.vb1(web, "setTranslatesAutoresizingMaskIntoConstraints:", 0);
	S.vb1(content, "setTranslatesAutoresizingMaskIntoConstraints:", 0);

	// Auto Layout replaces setFrame:. Attributes: 3 top, 4 bottom, 5 leading,
	// 6 trailing, 7 width, 8 height; relatedBy 0 is equal.
	const constraints: unknown[] = [
		shim().symbols.shim_constraint(web, 5n, 0n, content, 5n, 1, 0),
		shim().symbols.shim_constraint(web, 6n, 0n, content, 6n, 1, 0),
		shim().symbols.shim_constraint(web, 3n, 0n, content, 3n, 1, 0),
		shim().symbols.shim_constraint(web, 4n, 0n, content, 4n, 1, 0),
		shim().symbols.shim_constraint_simple(web, 7n, 0n, width),
		shim().symbols.shim_constraint_simple(web, 8n, 0n, height),
	];
	for (const raw of constraints) {
		const constraint = ptrValue(raw, "constraintWithItem:");
		if (!constraint) throw new Error("constraintWithItem: returned null");
		S.vb1(constraint, "setActive:", 1);
	}

	// The title is built and applied inside C: a short ASCII NSString is a
	// tagged pointer and cannot be marshalled through bun:ffi.
	if (options.title) {
		shim().symbols.shim_window_set_title(win, cstr(options.title));
		const applied = String(shim().symbols.shim_window_title_utf8(win) ?? "");
		if (applied !== options.title)
			throw new Error(`window title applied as ${JSON.stringify(applied)}`);
	}

	S.v1(win, "makeKeyAndOrderFront:", 0);
	// `makeKeyAndOrderFront:` raises the window but still depends on the app being able to
	// activate, and macOS 14+ refuses that for an unbundled process — which is exactly how
	// `crust dev` runs. The window then exists, the page loads, and nothing appears on
	// screen, silently. This raises it above its siblings without needing activation, so a
	// dev session and a bundle behave the same.
	S.v0(win, "orderFrontRegardless");
	// `canJoinAllSpaces | fullScreenAuxiliary` = 257. A launched app's window otherwise
	// lands on the desktop Space while the user is in a fullscreen one: it is created,
	// visible to AppKit, and on no Space they can see (measured: `on active space 0` with
	// the app unable to activate). This is what makes an app appear where it was launched.
	try {
		S.vq1(win, "setCollectionBehavior:", 257);
	} catch {
		// Older systems: the default behaviour is the fallback.
	}
	activate();

	// A relative URL needs the bridge server, which the platform does not own;
	// only an absolute URL can be handed to NSURL as-is.
	const raw = options.url ?? "/";
	const url = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : "about:blank";
	const loaded = Number(shim().symbols.shim_webview_load(web, cstr(url)) ?? 0);
	if (!loaded) throw new Error(`shim_webview_load failed for ${url}`);

	// Two numbers a blank window makes worth printing: its window number for
	// `screencapture -l`, and whether AppKit thinks it is visible. A page that renders and
	// then disappears is otherwise indistinguishable from a page that never loaded.
	try {
		const number = Number(shim().symbols.shim_window_number(win) ?? 0);
		const visible = Number(shim().symbols.shim_window_is_visible(win) ?? 0);
		console.log(
			`  window    ${label} number ${number}, visible ${visible}, on active space ${Number(shim().symbols.shim_window_is_on_active_space(win) ?? -1)}`,
		);
	} catch {
		// Diagnostics only.
	}
	return { win, web, url };
}
