/**
 * The three steps that need a loaded page: the document, its scripts, and one invoke crossing the
 * bridge. Each answers `{ ok, detail }` so the smoke prints one PASS/FAIL line per step while the
 * flow lives here. Nothing fakes a result: a missing symbol, a deadline, a throw and a failed load
 * each come back as their own detail text.
 */
import type { LinuxProofShim } from "../../src/platform/linux/shim-ffi.ts";
import { evaluate, LOAD_FAILED, LOAD_FINISHED, waitFor } from "./proof-eval.ts";
import {
	DOCUMENT_TITLE,
	ECHOED,
	INVOKE_PENDING,
	invokeScript,
	type ProofPage,
} from "./proof-page.ts";

/** A step's verdict and the one line a log keeps. */
export interface Step {
	ok: boolean;
	detail: string;
}

/** A real page over the bridge is slow the first time: WebKit starts its own processes. */
const LOAD_MS = 20_000;

/** One script's round trip; the deadline is a hang guard, not the normal path. */
const EVAL_MS = 5_000;

/** How many times the invoke poll re-reads the page before it gives up. */
const INVOKE_POLLS = 40;

/**
 * The document: `load-changed` must reach FINISHED, and the title read back through
 * `webkit_web_view_get_title` must be the document's own rather than the window's.
 */
export async function documentStep(shim: LinuxProofShim, web: bigint): Promise<Step> {
	const settled = await waitFor(
		() => [LOAD_FINISHED, LOAD_FAILED].includes(shim.shim_webview_load_state(web)),
		LOAD_MS,
	);
	const state = shim.shim_webview_load_state(web);
	const title = shim.shim_webview_title(web) ?? "";
	if (!settled)
		return {
			ok: false,
			detail: `no load-changed FINISHED within ${LOAD_MS} ms (state ${state})`,
		};
	if (state !== LOAD_FINISHED)
		return {
			ok: false,
			detail: `load FAILED: ${shim.shim_webview_load_text(web) ?? "no message"}`,
		};
	return {
		ok: title === DOCUMENT_TITLE,
		detail: `load-changed reached FINISHED; webkit_web_view_get_title returned "${title}"`,
	};
}

/** Page JS: one arithmetic evaluation and one that reads the document it runs in. */
export async function jsStep(shim: LinuxProofShim, web: bigint): Promise<Step> {
	const sum = await evaluate(shim, web, "1+1", EVAL_MS);
	const readBack = await evaluate(shim, web, "document.title", EVAL_MS);
	return {
		ok: sum.ok && sum.text === "2" && readBack.ok && readBack.text === DOCUMENT_TITLE,
		detail:
			`evaluate_javascript: 1+1 = ${sum.text || "(no answer)"}; ` +
			`document.title = ${readBack.text || "(no answer)"}`,
	};
}

/**
 * Invoke: the page calls the app's own client, the host answers, and the page holds that answer.
 * With no bridge there is nothing to cross, so the step reports itself unproved and says why.
 */ export async function invokeStep(
	shim: LinuxProofShim,
	web: bigint,
	page: ProofPage | undefined,
	pageError: string,
): Promise<Step> {
	if (page === undefined)
		return {
			ok: false,
			detail: `NOT PROVEN — the bridge could not start: ${pageError}`,
		};
	await evaluate(shim, web, invokeScript(), EVAL_MS);
	let held = "";
	for (let poll = 0; poll < INVOKE_POLLS; poll++) {
		const answer = await evaluate(shim, web, "String(window.__crustSmoke)", EVAL_MS);
		held = answer.text;
		if (!answer.ok || held !== INVOKE_PENDING) break;
		await Bun.sleep(25);
	}
	const ok = held.startsWith("ok ") && held.includes(JSON.stringify(ECHOED));
	return {
		ok,
		detail: ok
			? `window.crust.invoke("smoke", "echo") answered ${held}`
			: `the page held ${held || "(nothing)"}`,
	};
}

/**
 * A URL that cannot load, and one that really reports it. A refused connection does not: measured
 * on ubuntu-sandbox, `http://127.0.0.1:1/` reports started, committed, finished with WebKit's own
 * error page and never `load-failed`, so a missing file is what proves the error path.
 */
export const MISSING_FILE_URL = "file:///nonexistent-crust-smoke/x.html";

/**
 * A load that must fail: WebKit answers `load-failed`, the shim records its URI and GLib's message,
 * and the pump settles — so the error path is a printed line rather than a hang.
 */
export async function failureStep(shim: LinuxProofShim, web: bigint): Promise<Step> {
	const settled = await waitFor(() => shim.shim_webview_load_state(web) === LOAD_FAILED, LOAD_MS);
	const state = shim.shim_webview_load_state(web);
	if (!settled)
		return {
			ok: false,
			detail: `no load-failed within ${LOAD_MS} ms (state ${state})`,
		};
	const text = shim.shim_webview_load_text(web) ?? "";
	return {
		ok: text.length > 0,
		detail: `load-failed reported: ${text || "(no message)"}`,
	};
}
