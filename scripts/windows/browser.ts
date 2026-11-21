/**
 * The browser adapter on the real runtime: a local page a second surface loads, the plugin's two gates
 * in front of it, and a child window of the app's own window holding a controller of its own.
 *
 * Five facts, none of which a fake can give: an origin outside `browser.origins` is refused before any
 * child exists; an allowed one opens, and the remote document's title is what `state` answers; the
 * surface is a **second** surface beside the app's own webview; `setBounds` moves the child and Win32's
 * client rect follows; and `close` destroys it, after which the label is `not-found`.
 *
 * What it does not claim: a picture (`capture` refuses by name on this platform) and a popup handed to
 * a desktop — a runner has no browser to hand one to.
 */

import { windowsBrowserAdapter } from "../../src/platform/windows/browser.ts";
import { realPorts, type WindowsBrowserPorts } from "../../src/platform/windows/browser-ports.ts";
import type { WindowsPlatform } from "../../src/platform/windows/index.ts";
import { createBrowserPlugin } from "../../src/plugins/browser.ts";
import type { Verdict } from "../e2e-harness.ts";

/** The surface's document, distinct from the app's own `about:blank` in title and address. */
export const BROWSER_TITLE = "crust browser surface";
export const BROWSER_FIRST = { x: 24, y: 16, width: 220, height: 120 };
export const BROWSER_MOVED = { x: 40, y: 32, width: 180, height: 90 };

/** A first WebView2 navigation starts its browser process; the title trails `NavigationCompleted`. */
const LOAD_MS = 20_000;
const SIZED_MS = 5_000;

interface BrowserProof {
	ok: boolean;
	detail: string;
}

/** Poll one read until it answers what was asked, or the deadline says it never did. */
async function until(read: () => boolean, ms: number): Promise<boolean> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (read()) return true;
		await Bun.sleep(30);
	}
	return read();
}

/** A `PluginContext` whose `emit` records instead of pushing to a stream. */
function collector() {
	const events: Array<{ event: string; data: unknown }> = [];
	return {
		events,
		ctx: {
			emit: (event: string, data: unknown) => events.push({ event, data }),
		},
	};
}

/**
 * The adapter, driven through the plugin exactly as a page drives it. The ports are the real ones,
 * wrapped so this proof knows the child HWND the adapter created — the adapter keeps its surfaces to
 * itself — and can read Win32's client rect for it.
 */
async function proveBrowser(platform: WindowsPlatform): Promise<BrowserProof> {
	const server = Bun.serve({
		port: 0,
		fetch: () =>
			new Response(`<title>${BROWSER_TITLE}</title><p>surface</p>`, {
				headers: { "content-type": "text/html; charset=utf-8" },
			}),
	});
	const origin = `http://127.0.0.1:${server.port}`;
	const ports = realPorts();
	const children: number[] = [];
	const wrapped: WindowsBrowserPorts = {
		...ports,
		child: (parent, bounds) => {
			const child = ports.child(parent, bounds);
			children.push(child);
			return child;
		},
	};
	const plugin = createBrowserPlugin({ origins: [origin] }, windowsBrowserAdapter(wrapped));
	const { events, ctx } = collector();
	const shim = platform.shim();
	// The pump dispatches WebView2's own events and completions, so a load never settles without it.
	platform.pump(8);
	try {
		const refused = plugin.commands.open(
			{
				label: "evil",
				url: "https://not-allowed.test/",
				bounds: BROWSER_FIRST,
			},
			ctx,
		) as { ok: boolean; code?: string };
		if (refused.ok || refused.code !== "bad-request")
			return {
				ok: false,
				detail: `a foreign origin was not refused: ${JSON.stringify(refused)}`,
			};
		if (children.length !== 0)
			return {
				ok: false,
				detail: "a refused origin still created a child window",
			};

		const opened = plugin.commands.open(
			{ label: "docs", url: `${origin}/`, bounds: BROWSER_FIRST },
			ctx,
		);
		if (!("ok" in opened) || opened.ok !== true)
			return {
				ok: false,
				detail: `open refused: ${JSON.stringify(opened)}`,
			};
		const child = children[0] ?? 0;
		if (child === 0) return { ok: false, detail: "the adapter created no child window" };

		const titled = await until(() => {
			const read = plugin.commands.state({ label: "docs" }, ctx);
			return "title" in read && read.title === BROWSER_TITLE;
		}, LOAD_MS);
		const state = plugin.commands.state({ label: "docs" }, ctx);
		if (!titled || !("title" in state))
			return {
				ok: false,
				detail: `the surface never titled itself: ${JSON.stringify(state)}`,
			};
		if (!state.url.startsWith(origin))
			return {
				ok: false,
				detail: `state.url answered "${state.url}", not ${origin}`,
			};

		// Two surfaces on one environment: the app's own webview at handle 0 and this one beside it.
		const surfaces = Number(shim?.shim_webview_live() ?? 0);
		const before = sizeOf(platform, child);
		const moved = plugin.commands.setBounds({ label: "docs", bounds: BROWSER_MOVED }, ctx);
		if (!("ok" in moved) || moved.ok !== true)
			return {
				ok: false,
				detail: `setBounds refused: ${JSON.stringify(moved)}`,
			};
		const resized = await until(
			() => sizeOf(platform, child).width === BROWSER_MOVED.width,
			SIZED_MS,
		);
		const after = sizeOf(platform, child);
		const closed = plugin.commands.close({ label: "docs" }, ctx);
		const gone = plugin.commands.state({ label: "docs" }, ctx);
		const detail =
			`refused a foreign origin; "${state.title}" from ${state.url}; ${surfaces} surface(s) live; ` +
			`client ${before.width}x${before.height} → ${after.width}x${after.height} for ` +
			`${BROWSER_MOVED.width}x${BROWSER_MOVED.height}; close ${JSON.stringify(closed)} and state ` +
			`${JSON.stringify(gone)}; ${events.length} event(s)`;
		return {
			ok:
				surfaces === 2 &&
				before.width === BROWSER_FIRST.width &&
				resized &&
				after.width === BROWSER_MOVED.width &&
				closed.ok &&
				"code" in gone &&
				gone.code === "not-found",
			detail,
		};
	} finally {
		platform.stopPump();
		server.stop(true);
	}
}

/** Win32's own client rect for the child, which is what the controller is sized from. */
function sizeOf(platform: WindowsPlatform, child: number): { width: number; height: number } {
	const shim = platform.shim();
	return {
		width: Number(shim?.shim_window_client_num(child, 2) ?? 0),
		height: Number(shim?.shim_window_client_num(child, 3) ?? 0),
	};
}

/** The smoke's line for this proof, kept here so `windows-smoke.ts` stays under the cap. */
export async function checkBrowser(verdict: Verdict, platform: WindowsPlatform): Promise<void> {
	const result = await proveBrowser(platform);
	verdict.check("browser", result.ok, result.detail);
}
