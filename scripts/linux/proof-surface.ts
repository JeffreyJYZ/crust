/**
 * The positioned container, proven on real GTK: the app's own page is the window container's main
 * child, a second webview placed over it loads its own document, and `state` answers per handle —
 * the app's view while the surface loads, then the surface after it. Moving a surface is a rectangle
 * change, not a reload.
 *
 * What it does not claim: a picture of the surface itself. `window.capture` photographs the app's
 * own webview (proof-capture.ts), never a native sibling view, so the surface's title and load state
 * are the evidence here.
 */
import type { LinuxShim } from "../../src/platform/linux/shim-ffi.ts";
import type { NativeWindow } from "../../src/platform/linux/backend.ts";
import { cstring } from "../../src/platform/linux/cstring.ts";
import type { LinuxProofShim } from "../../src/platform/linux/shim-ffi.ts";
import { LOAD_FAILED, LOAD_FINISHED, evaluate, waitFor } from "./proof-eval.ts";
import type { Step } from "./proof-steps.ts";

/** A real page is slow the first time: WebKit starts its own processes. */
const LOAD_MS = 20_000;

/**
 * How long the title is allowed to lag FINISHED. `load-changed` reports the navigation, and WebKit
 * fills the document's title a main-context iteration or two later — measured: the first read after
 * FINISHED answered `""` on the ubuntu gate while the document had already parsed.
 */
const TITLE_MS = 2_000;

/** One script's round trip; the deadline is a hang guard, not the normal path. */
const EVAL_MS = 5_000;

/** The surface's document, title included, so it cannot be mistaken for the app's page. */
export const SURFACE_TITLE = "crust smoke surface";
export const SURFACE_URL = `data:text/html,${encodeURIComponent(
	`<title>${SURFACE_TITLE}</title><p>surface</p>`,
)}`;

/** The rectangle a surface is placed at, then moved to; both are window points. */
export const FIRST_BOUNDS = { x: 24, y: 16, width: 220, height: 120 };
export const MOVED_BOUNDS = { x: 40, y: 32, width: 180, height: 90 };

/**
 * The container: one per window, the app's view inside it, and a second view placed and moved.
 * Every answer here is the shim's own, so a surface that never became a child fails by name.
 */
export async function surfaceStep(
	shim: LinuxShim & LinuxProofShim,
	app: NativeWindow,
): Promise<Step> {
	if (app.box === 0n) return { ok: false, detail: "the window reported no container" };
	// Asking twice must answer the same address: a second container would be one nothing sized,
	// and the surface would be placed where the app's page is not.
	const again = BigInt(Number(shim.shim_window_container(app.win) ?? 0));
	if (again !== app.box)
		return { ok: false, detail: `a second container appeared (${app.box} then ${again})` };
	const surface = BigInt(Number(shim.shim_webview_new() ?? 0));
	if (surface === 0n)
		return { ok: false, detail: "shim_webview_new returned null for a surface" };
	if (
		shim.shim_webview_place(
			app.box,
			surface,
			FIRST_BOUNDS.x,
			FIRST_BOUNDS.y,
			FIRST_BOUNDS.width,
			FIRST_BOUNDS.height,
		) !== 1
	)
		return { ok: false, detail: "shim_webview_place refused the first rectangle" };
	if (Number(shim.shim_webview_load(surface, cstring(SURFACE_URL)) ?? 0) !== 1)
		return { ok: false, detail: "shim_webview_load refused the surface URL" };
	const settled = await waitFor(
		() => shim.shim_webview_load_state(surface) === LOAD_FINISHED,
		LOAD_MS,
	);
	const state = shim.shim_webview_load_state(surface);
	if (!settled)
		return { ok: false, detail: `the surface never finished loading (state ${state})` };
	// The title trails FINISHED, so it is polled rather than read once. If `get_title` still has
	// nothing, the document is asked for its own title by script: a view that answers is live and
	// parsed either way, and which one answered is part of the report.
	let title = shim.shim_webview_title(surface) ?? "";
	if (title !== SURFACE_TITLE)
		await waitFor(() => (shim.shim_webview_title(surface) ?? "") === SURFACE_TITLE, TITLE_MS);
	title = shim.shim_webview_title(surface) ?? "";
	let scriptTitle = "";
	if (title !== SURFACE_TITLE) {
		const read = await evaluate(shim, surface, "document.title", EVAL_MS);
		scriptTitle = read.text;
	}
	const named = title === SURFACE_TITLE ? title : scriptTitle;
	// The app's page loaded first. One process-wide slot would have reported the surface's load here,
	// which is exactly the defect the keyed record removes.
	const appState = shim.shim_webview_load_state(app.web);
	if (
		shim.shim_webview_place(
			app.box,
			surface,
			MOVED_BOUNDS.x,
			MOVED_BOUNDS.y,
			MOVED_BOUNDS.width,
			MOVED_BOUNDS.height,
		) !== 1
	)
		return { ok: false, detail: "shim_webview_place refused the move" };
	return {
		ok: named === SURFACE_TITLE && appState === LOAD_FINISHED,
		detail:
			`placed at ${FIRST_BOUNDS.x},${FIRST_BOUNDS.y} ${FIRST_BOUNDS.width}x${FIRST_BOUNDS.height} then moved; ` +
			`title "${title}"${scriptTitle ? ` (document.title "${scriptTitle}")` : ""}; the app's view still ${appState}`,
	};
}

/**
 * The decisive per-handle proof: after a second window's load fails, the app's own view must still
 * answer FINISHED and the failed one must carry its own message. With one process-wide slot both
 * read 4, because the failure was recorded once for the whole process.
 */
export function keyedStateStep(shim: LinuxProofShim, app: bigint, failed: bigint): Step {
	const appState = shim.shim_webview_load_state(app);
	const failedState = shim.shim_webview_load_state(failed);
	const text = shim.shim_webview_load_text(failed) ?? "";
	return {
		ok: appState === LOAD_FINISHED && failedState === LOAD_FAILED && text.length > 0,
		detail:
			`the app's view answers ${appState} (finished) while the failing one answers ${failedState} (failed), ` +
			`its own text "${text.slice(0, 80)}"`,
	};
}
