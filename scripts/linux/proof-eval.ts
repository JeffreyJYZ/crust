/**
 * Reading an answer back out of the page: one `webkit_web_view_evaluate_javascript` at a time,
 * resolved by the same main-context pump the app runs, and bounded by a real deadline so a page
 * that never answers is a FAIL rather than a hang. Nothing here fakes an answer: a missing symbol,
 * a deadline and a throw each come back as their own text.
 */
import { cstring } from "../../src/platform/linux/cstring.ts";
import type { LinuxProofShim } from "../../src/platform/linux/shim-ffi.ts";

/** `WebKitLoadEvent`'s finished value, and the failure the shim reports as 4. */
export const LOAD_FINISHED = 3;
export const LOAD_FAILED = 4;

/** The shim's own eval states: nothing settled yet, or an answer arrived. */
const EVAL_PENDING = 0;
const EVAL_ANSWERED = 1;

/** Poll a predicate while the pump runs; false at the deadline, never a hang. */
export async function waitFor(predicate: () => boolean, ms: number): Promise<boolean> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (predicate()) return true;
		await Bun.sleep(10);
	}
	return predicate();
}

export interface Answer {
	ok: boolean;
	text: string;
}

/** Run one script and read its answer, or the message a throw carried. */
export async function evaluate(
	shim: LinuxProofShim,
	web: bigint,
	script: string,
	ms: number,
): Promise<Answer> {
	if (shim.shim_webview_eval(web, cstring(script)) !== 1) {
		return { ok: false, text: "webkit_web_view_evaluate_javascript is not on this machine" };
	}
	const settled = await waitFor(() => shim.shim_webview_eval_state(web) !== EVAL_PENDING, ms);
	if (!settled) return { ok: false, text: `no answer within ${ms} ms` };
	const state = shim.shim_webview_eval_state(web);
	return { ok: state === EVAL_ANSWERED, text: String(shim.shim_webview_eval_text(web) ?? "") };
}
