/**
 * The browser adapter on real GTK: a local page the surface loads, the plugin's two gates in front of
 * it, and the container the surface is placed into.
 *
 * Five facts, none of which a fake can give: the plugin refuses an origin outside `browser.origins`
 * before any view exists; an allowed one opens and its remote document's title is what `state`
 * answers; `setBounds` re-places the view and GTK's own allocation follows; the app's own page and the
 * surface answer for themselves; and `close` destroys the view, after which the label is `not-found`.
 *
 * What it does not claim: a picture (`capture` refuses by name on this platform), and a popup handed
 * to the desktop — a runner has no browser to hand one to.
 */

import { linuxBrowserAdapter } from "../../src/platform/linux/browser.ts";
import type { LinuxBrowserPorts } from "../../src/platform/linux/browser-ports.ts";
import { realPorts } from "../../src/platform/linux/browser-ports.ts";
import type { LinuxProofShim, LinuxShim } from "../../src/platform/linux/shim-ffi.ts";
import { createBrowserPlugin } from "../../src/plugins/browser.ts";
import { waitFor } from "./proof-eval.ts";
import type { Step } from "./proof-steps.ts";

/** The surface's document, distinct from the app's own page in title and address. */
export const BROWSER_TITLE = "crust browser surface";
export const FIRST = { x: 24, y: 16, width: 220, height: 120 };
export const MOVED = { x: 40, y: 32, width: 180, height: 90 };

/** A first load starts WebKit's own processes; the title trails FINISHED by an iteration. */
const LOAD_MS = 20_000;
const ALLOC_MS = 5_000;

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

/** Poll one read until it answers what was asked, or the deadline says it never did. */
async function until(read: () => boolean, ms: number): Promise<boolean> {
	return waitFor(read, ms);
}

/**
 * The adapter, driven through the plugin exactly as a page drives it. The ports are the real ones,
 * wrapped so this proof knows the `WebKitWebView *` the adapter created and can read GTK's allocation
 * for it — the adapter deliberately keeps its views to itself.
 */
export async function browserStep(shim: LinuxShim & LinuxProofShim): Promise<Step> {
	const server = Bun.serve({
		port: 0,
		fetch: () =>
			new Response(`<title>${BROWSER_TITLE}</title><p>surface</p>`, {
				headers: { "content-type": "text/html; charset=utf-8" },
			}),
	});
	const origin = `http://127.0.0.1:${server.port}`;
	const ports = realPorts();
	const placements: Array<{
		web: bigint;
		width: number;
		height: number;
		x: number;
		y: number;
	}> = [];
	const wrapped: LinuxBrowserPorts = {
		...ports,
		place: (box, web, bounds) => {
			const placed = ports.place(box, web, bounds);
			if (placed)
				placements.push({
					web,
					width: bounds.width,
					height: bounds.height,
					x: bounds.x,
					y: bounds.y,
				});
			return placed;
		},
	};
	const plugin = createBrowserPlugin({ origins: [origin] }, linuxBrowserAdapter(wrapped));
	// No popup happens in this fixture page, so there is nothing for a stream to carry. The popup path
	// is proved by the adapter's own tests and by the C signal handlers; this proof needs a context only.
	const ctx = { emit: () => {} };
	try {
		const refused = plugin.commands.open(
			{ label: "evil", url: "https://not-allowed.test/", bounds: FIRST },
			ctx,
		) as { ok: boolean; code?: string; message?: string };
		if (refused.ok || refused.code !== "bad-request")
			return {
				ok: false,
				detail: `a foreign origin was not refused: ${JSON.stringify(refused)}`,
			};

		const opened = plugin.commands.open(
			{ label: "docs", url: `${origin}/`, bounds: FIRST },
			ctx,
		);
		if (!("ok" in opened) || opened.ok !== true)
			return {
				ok: false,
				detail: `open refused: ${JSON.stringify(opened)}`,
			};
		if (placements.length !== 1 || placements[0]?.web === 0n)
			return {
				ok: false,
				detail: "the adapter created no view in the window's container",
			};
		const web = (placements[0] as { web: bigint }).web;

		const titled = await until(() => {
			const read = plugin.commands.state({ label: "docs" }, ctx);
			return (
				"title" in read &&
				read.title === BROWSER_TITLE &&
				!(read as { loading: boolean }).loading
			);
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

		// The view's own allocation, not the request: a placement that never reached GTK shows here.
		const grew = await until(() => readAllocation(shim, web).width === FIRST.width, ALLOC_MS);
		const before = readAllocation(shim, web);
		const requested = readRequest(shim, web);
		const moved = plugin.commands.setBounds({ label: "docs", bounds: MOVED }, ctx);
		if (!("ok" in moved) || moved.ok !== true)
			return {
				ok: false,
				detail: `setBounds refused: ${JSON.stringify(moved)}`,
			};
		const resized = await until(
			() => readAllocation(shim, web).width === MOVED.width,
			ALLOC_MS,
		);
		const after = readAllocation(shim, web);
		const requestAfter = readRequest(shim, web);
		const closed = plugin.commands.close({ label: "docs" }, ctx);
		const gone = plugin.commands.state({ label: "docs" }, ctx);
		const detail =
			`refused a foreign origin; "${state.title}" from ${state.url}; allocated ` +
			`${before.width}x${before.height} then ${after.width}x${after.height} for ` +
			`${MOVED.width}x${MOVED.height} (GTK size request ${requested.width}x${requested.height} then ` +
			`${requestAfter.width}x${requestAfter.height}); closed ${JSON.stringify(closed)} and state answered ` +
			`${JSON.stringify(gone)}`;
		return {
			ok:
				grew &&
				resized &&
				before.width === FIRST.width &&
				closed.ok &&
				"code" in gone &&
				gone.code === "not-found",
			detail,
		};
	} finally {
		server.stop(true);
	}
}

/** GTK's size request for one view, read back after each placement. */
function readRequest(
	shim: LinuxShim & LinuxProofShim,
	web: bigint,
): { width: number; height: number } {
	return {
		width: Number(shim.shim_webview_requested?.(web, 0) ?? 0),
		height: Number(shim.shim_webview_requested?.(web, 1) ?? 0),
	};
}

/** GTK's allocation for one view, as the two numbers the proof compares. */
function readAllocation(
	shim: LinuxShim & LinuxProofShim,
	web: bigint,
): { width: number; height: number } {
	return {
		width: Number(shim.shim_webview_allocated?.(web, 0) ?? 0),
		height: Number(shim.shim_webview_allocated?.(web, 1) ?? 0),
	};
}
