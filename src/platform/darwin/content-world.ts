/**
 * The credential-holding bridge for a darwin webview.
 *
 * Two `WKUserScript`s go on the window's user content controller before its URL is loaded: one in
 * `WKContentWorld` (macOS 11+), which reads the bridge token and answers invoke requests, and one in
 * the page's own world, which exposes `window.crustInvoke` and nothing else. The DOM is shared
 * between worlds and the JS object graph is not, so the two halves talk over DOM events carrying
 * JSON strings.
 *
 * What this buys, stated honestly: page script can still call every command the window is granted —
 * that is the point — and can no longer read the token or replace the transport. It does not make a
 * granted command safe; `fs:*` still writes files.
 *
 * A platform without a content world keeps the fetch path: `shim_content_world()` answers 0 when
 * `WKContentWorld` is missing, and `install` then reports `false` so the client falls back.
 */
import { cstr, S, SEL } from "./objc.ts";
import { shim } from "./index.ts";
import { CONTENT_WORLD_SOURCE, PAGE_BRIDGE_SOURCE } from "./content-world-source.ts";

export { CONTENT_WORLD_SOURCE, PAGE_BRIDGE_SOURCE } from "./content-world-source.ts";

/** True when this macOS has `WKContentWorld` at all, without building a window to find out. */
export function contentWorldAvailable(): boolean {
	return Number(shim().symbols.shim_content_world() ?? 0) > 0;
}

/**
 * How many user scripts a webview's controller already carries. Read from WebKit rather than
 * remembered in a module flag: every window is built from the one shared
 * `WKWebViewConfiguration`, so its controller is the same object and the count is the shared state.
 */
function scriptsOn(web: number): number {
	try {
		const config = S.p0(web, "configuration");
		const controller = S.p0(config, "userContentController");
		const scripts = S.p0(controller, "userScripts");
		return Number(shim().symbols.shim_send_q0(scripts, SEL("count")) ?? -1);
	} catch {
		// A selector this system lacks is the same answer as none installed: fall back to fetch.
		return -1;
	}
}

/**
 * Install the bridge on one webview, before it loads.
 *
 * Exactly one install per process, because the scripts do not belong to a webview: every window is
 * built from the one shared `WKWebViewConfiguration`, so its `userContentController` is the same
 * object, and WebKit hands those scripts to every webview built from it (measured: a second webview
 * created after the install carries both). Installing per window put the isolated half on the page
 * twice — the first copy scrubs `?token=` at document start, the second then reads an empty token and
 * posts `Bearer `, so the page's first call raced a 401 against the real request.
 *
 * `documentUrl` gates the whole thing: the isolated half gets its token from the document's own
 * query, so a page that arrived without one — a `crust dev` page the Vite server served, which
 * carries `window.__CRUST__` instead — has nothing to give it and must keep the fetch path. Gating
 * here rather than inside the script is what keeps the two halves from racing at document start.
 *
 * Returns false when the URL carries no token, or when WebKit refused. Nothing is half-installed:
 * the isolated half fails first, and the page half is only useful beside it.
 */
export function installContentWorldBridge(web: number, documentUrl: string): boolean {
	if (!web) return false;
	// The controller already carries both halves, so this webview has them without a second copy.
	if (scriptsOn(web) > 0) return true;
	if (!/[?&]token=/.test(documentUrl)) return false;
	const symbols = shim().symbols;
	// Never a bare 0 for the page's world: `-initWithSource:…inContentWorld:` dereferences it and
	// faults at 0x10 with no Objective-C exception, so each world is resolved from an integer.
	const world = Number(symbols.shim_content_world_named(1) ?? 0);
	if (!world) return false;
	const isolated = Number(
		symbols.shim_webview_add_user_script(web, world, cstr(CONTENT_WORLD_SOURCE), 1) ?? 0,
	);
	if (!isolated) return false;
	// The page's own world is what page script sees, which is why this half carries no token.
	const page = Number(symbols.shim_content_world_named(0) ?? 0);
	if (!page) return false;
	// Nothing is remembered between calls: the count above is the state, so a refused install leaves
	// the next window on the fetch path instead of believing it has a bridge.
	return (
		Number(symbols.shim_webview_add_user_script(web, page, cstr(PAGE_BRIDGE_SOURCE), 1) ?? 0) >
		0
	);
}
