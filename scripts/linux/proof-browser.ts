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
import { hex, readAllocation, readRequest } from "./proof-layout.ts";
import { createBrowserPlugin } from "../../src/plugins/browser.ts";
import type { NativeWindow } from "../../src/platform/linux/backend.ts";
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
export async function browserStep(
	shim: LinuxShim & LinuxProofShim,
	app: NativeWindow,
): Promise<Step> {
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

		// Attribute the allocation before judging it: three widgets live in this window, and only the
		// placed surface's own allocation answers the question. The parent and the placement log say
		// whether `setBounds` reached the same C placement path the first `open` took.
		const boxRect = readAllocation(shim, app.box);
		const appRect = readAllocation(shim, app.web);
		const parent = BigInt(Number(shim.shim_webview_parent?.(web) ?? 0));
		const grew = await until(() => {
			const rect = readAllocation(shim, web);
			return rect.width === FIRST.width && rect.height === FIRST.height;
		}, ALLOC_MS);
		const before = readAllocation(shim, web);
		const requested = readRequest(shim, web);
		const layout = [0, 1, 2, 3, 4].map((which) =>
			Number(shim.shim_webview_layout?.(web, which) ?? -1),
		);
		const moved = plugin.commands.setBounds({ label: "docs", bounds: MOVED }, ctx);
		if (!("ok" in moved) || moved.ok !== true)
			return {
				ok: false,
				detail: `setBounds refused: ${JSON.stringify(moved)}`,
			};
		const resized = await until(() => {
			const rect = readAllocation(shim, web);
			return rect.width === MOVED.width && rect.height === MOVED.height;
		}, ALLOC_MS);
		const after = readAllocation(shim, web);
		const requestAfter = readRequest(shim, web);
		const closed = plugin.commands.close({ label: "docs" }, ctx);
		const gone = plugin.commands.state({ label: "docs" }, ctx);
		const rect = (r: { width: number; height: number }) => `${r.width}x${r.height}`;
		const placeLog = placements.map((p) => `${p.x},${p.y} ${p.width}x${p.height}`).join(" > ");
		const detail =
			`box ${hex(app.box)} ${rect(boxRect)}, app ${hex(app.web)} ${rect(appRect)}, ` +
			`surface ${hex(web)} parent ${hex(parent)} allocated ${rect(before)} then ${rect(after)} ` +
			`for ${MOVED.width}x${MOVED.height} (request ${rect(requested)} then ${rect(requestAfter)}; ` +
			`expand ${layout[0]}/${layout[1]} align ${layout[2]}/${layout[3]} margin ${layout[4]}); ` +
			`placements ${placeLog}; refused a foreign origin; "${state.title}" from ${state.url}; ` +
			`closed ${JSON.stringify(closed)} and state ${JSON.stringify(gone)}`;
		return {
			ok:
				parent === app.box &&
				(placements.length as number) === 2 &&
				grew &&
				resized &&
				before.width === FIRST.width &&
				before.height === FIRST.height &&
				after.width === MOVED.width &&
				after.height === MOVED.height &&
				requestAfter.width === MOVED.width &&
				requestAfter.height === MOVED.height &&
				closed.ok &&
				"code" in gone &&
				gone.code === "not-found",
			detail,
		};
	} finally {
		server.stop(true);
	}
}
