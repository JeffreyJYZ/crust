/**
 * Build the window with `initWithContentRect:` on the C stack (a bare `[[NSWindow alloc] init]` aborts from AppKit's event thread), add the webview, pin it with Auto Layout, order front, then load the URL inside C.
 * Kept away from `DarwinPlatform` so construction and tracking read separately; activation is passed in because it is the one platform fact this needs, and it is already decided by `app.activate`.
 */
import type { WindowOptions } from "@/app.ts";
import type { WindowMaterial } from "@/config";
import { type Activation, activateForWindow } from "./activation.ts";
import { installContentWorldBridge } from "./content-world.ts";
import { devInspectEnabled } from "./devtools.ts";
import { shim } from "./index.ts";
import { cls, cstr, ptrValue, S } from "./objc.ts";
import { webviewConfiguration } from "./webview-configuration.ts";
import type { NativeWindowPointers } from "./windows.ts";

/** `minHeight` and `material` are validated on the config window but `WindowOptions` has not caught up. */
type MaterialOptions = WindowOptions & { minHeight?: number; material?: WindowMaterial };

/**
 * Effective create size and minimums. Clamping here keeps a window from opening smaller than the
 * size the user can later drag it back to; zero is AppKit's "no minimum" for either dimension.
 */
export function windowSize(
	options: MaterialOptions,
	fallback: { width: number; height: number },
): { width: number; height: number; minWidth: number; minHeight: number } {
	const minWidth = options.minWidth ?? 0;
	const minHeight = options.minHeight ?? 0;
	return {
		width: Math.max(options.width ?? fallback.width, minWidth),
		height: Math.max(options.height ?? fallback.height, minHeight),
		minWidth,
		minHeight,
	};
}

export function createNativeWindow(
	label: string,
	options: MaterialOptions,
	activation: Activation,
): NativeWindowPointers {
	const { width, height, minWidth, minHeight } = windowSize(options, {
		width: 1100,
		height: 760,
	});
	const material = options.material;
	if (material && material !== "none" && material !== "vibrancy") {
		throw new Error(`window material "${material}" is not available on macOS`);
	}
	// titled(1) | closable(2) | miniaturizable(4) | resizable(8); a material also needs the
	// full-size content mask (1 << 15) so the effect view reaches under the titlebar.
	const style = 15n | (material ? 32768n : 0n);
	const win = Number(shim().symbols.shim_window_new(120, 120, width, height, style, 2n, 0));
	if (!win) throw new Error("shim_window_new returned null");
	// Both minimums were validated and carried but were read by nobody until this landed. Zero
	// means "no constraint", so setting it for an unset dimension leaves the old behaviour intact.
	if (minWidth || minHeight) {
		shim().symbols.shim_window_set_min_size(win, minWidth, minHeight);
	}

	// A closed window must stay addressable: `-close` does not release it,
	// and the liveness read afterwards needs the object alive. Released, the
	// pointer would dangle and the next guarded send would fault.
	S.vb1(win, "setReleasedWhenClosed:", 0);

	// The webview is built from the app's one `WKWebViewConfiguration`, not from
	// `[[WKWebView alloc] init]`: that object is the only place a `WKURLSchemeHandler` can be
	// registered, and WebKit copies it here, so a handler added after this call never reaches
	// this webview. The frame is zero and Auto Layout owns the size, exactly as `-init` left it.
	const web = ptrValue(
		shim().symbols.shim_webview_new(webviewConfiguration(), 0, 0),
		"-[WKWebView initWithFrame:configuration:]",
	);
	if (!web) throw new Error("-[WKWebView initWithFrame:configuration:] returned null");
	if (material) {
		// Without drawsBackground=NO WebKit paints over the effect view, so a material that was
		// inserted but never shows is worse than no material at all.
		shim().symbols.shim_webview_set_draws_background(web, 0);
	}
	// DevTools is a dev-only surface: the C gate is the env flag, which only `crust dev` sets.
	if (devInspectEnabled()) shim().symbols.shim_webview_enable_devtools(web);

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

	if (material) {
		// A full-size content view puts the titlebar under the effect. A material owns the
		// background: it sets opaque=NO and a clear colour, so a `window.setOpacity` call later
		// still fades the whole window while the material stays behind the page.
		S.vb1(win, "setTitlebarAppearsTransparent:", 1);
		if (!Number(shim().symbols.shim_window_set_material(win) ?? 0)) {
			throw new Error("NSVisualEffectView is unavailable on this macOS version");
		}
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
	// `crust dev` runs. Measured 2026-11-16: such a window is built, its page loads, and it is
	// still off screen and out of the accessibility tree (AppKit `visible 1` while the
	// WindowServer reported it not on screen). This raises it above its siblings without needing
	// activation.
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
	// `-activate` is the macOS 14 cooperative call, and it is silently refused for a process
	// LaunchServices did not launch, so it alone never lands. Measured from a separate trusted
	// process: a directly-exec'd bundle answered `active no`, and its app element carried
	// `AXWindows` 0 with `AXChildren` = the menu bar alone — the window was mapped and
	// `screencapture -l` captured it, yet VoiceOver was blind to it. AppKit lists only windows on
	// the active Space (its own `accessibilityWindows` tracked `isOnActiveSpace` 1:1), and a
	// window joins that Space only when its app is the active one. `-activateIgnoringOtherApps:`
	// does land: `active yes`, then `AXWindows` 1 with 4 children from the same external read,
	// which is what makes the window key, on the active Space and in the tree.
	// Gated on `app.activate`: `always` tests `isActive` per window, `first` uses one process-wide
	// flag because `isActive` is false whenever the human is in another app, and `never` sends
	// nothing.
	activateForWindow(activation.mode, activation.once, {
		sharedApp: () => S.p0(cls("NSApplication"), "sharedApplication", true),
		isActive: (app) => S.b0(app, "isActive"),
		activateIgnoringOtherApps: (app) => S.vb1(app, "activateIgnoringOtherApps:", 1),
	});

	// A relative URL needs the bridge server, which the platform does not own;
	// only an absolute URL can be handed to NSURL as-is.
	const raw = options.url ?? "/";
	const url = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : "about:blank";
	// The bridge token lives in a `WKContentWorld` the page cannot read or patch, and the page's
	// world only gets `window.crustInvoke`. WebKit copies the controller's script list when the
	// webview is created and the load below is the last step, so both scripts are registered before
	// any page script can run. A `crust dev` page carries no token in its URL — it gets
	// `window.__CRUST__` from Vite — so the install refuses there and the fetch path stays in use.
	installContentWorldBridge(web, url);
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
