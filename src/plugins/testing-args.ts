/**
 * `crust:testing`'s argument readers and typed failures: what every command checks before a script
 * reaches a page, and how a page's own refusal becomes a value the bridge can send.
 *
 * Kept apart from the commands so the drive and observe halves share one reading of `label`,
 * `selector` and the answer envelope — a second copy of that parsing is how two commands drift.
 */

import { CrustError } from "../bridge/errors";
import type { NotImplemented } from "./define";
import { notImplemented } from "./define";
import type { PageAnswer, TestingArgs, TestingCode, TestingFailure, TestingSelectorArgs } from "./testing-types";

/** The refusal a platform that cannot evaluate a script answers, naming the call it lacks. */
export const EVALUATE_REQUIRES = "WKWebView -evaluateJavaScript:completionHandler:";

/** The codes a page may refuse with; anything else is the page's own bug and reads as a 500. */
const CODES = new Set<string>(["unknown-window", "not-found", "not-implemented", "handler-error"]);

export function missing(command: string): NotImplemented {
	return notImplemented(
		`testing.${command} needs ${EVALUATE_REQUIRES} and a window whose page it can run in. ` +
			"Pass a TestingAdapter to createTestingPlugin, or call setTestingAdapter from the platform that owns the webview.",
		EVALUATE_REQUIRES,
	);
}

/** The window a command names: absent is the first open window; a bad value is the caller's bug. */
export function labelOf(args: TestingArgs | undefined): string | undefined {
	const label = args?.label;
	if (label === undefined) return undefined;
	if (typeof label !== "string" || label.length === 0) {
		throw new CrustError(
			"bad-request",
			`testing: "label" must be a non-empty string when given, got ${JSON.stringify(label)}`,
		);
	}
	return label;
}

export function requireSelector(args: TestingSelectorArgs | undefined): string {
	const selector = args?.selector;
	if (typeof selector !== "string" || selector.length === 0) {
		throw new CrustError("bad-request", 'testing: "selector" must be a non-empty string');
	}
	return selector;
}

/** `type` needs text; an absent one is a caller bug, never an empty field typed silently. */
export function requireText(args: { text?: unknown } | undefined): string {
	if (typeof args?.text !== "string") {
		throw new CrustError("bad-request", 'testing.type needs { text } as a string');
	}
	return args.text;
}

/** A page-side throw arrives as a rejection; the adapter's own codes are kept, the rest is a 500. */
export function refused(error: unknown): TestingFailure {
	const code = (error as { code?: unknown } | undefined)?.code;
	const message = error instanceof Error ? error.message : String(error);
	if (code === "unknown-window") return { ok: false, code: "unknown-window", message };
	return { ok: false, code: "handler-error", message };
}

/** The page's JSON answer, or the typed failure it chose instead of a value. */
export function answered(command: string, raw: unknown): PageAnswer | TestingFailure {
	if (typeof raw !== "string") {
		const seen = raw === null || raw === undefined ? "nothing" : typeof raw;
		return {
			ok: false,
			code: "handler-error",
			message: `testing.${command}: the page answered ${seen}, not a JSON string`,
		};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {
			ok: false,
			code: "handler-error",
			message: `testing.${command}: the page answered non-JSON (${raw.slice(0, 120)})`,
		};
	}
	if (parsed === null || typeof parsed !== "object") {
		return {
			ok: false,
			code: "handler-error",
			message: `testing.${command}: the page answered ${JSON.stringify(parsed)}`,
		};
	}
	const answer = parsed as { ok?: unknown; code?: unknown; message?: unknown; requires?: unknown };
	if (answer.ok !== false) return parsed as PageAnswer;
	const code: TestingCode =
		typeof answer.code === "string" && CODES.has(answer.code)
			? (answer.code as TestingCode)
			: "handler-error";
	const message =
		typeof answer.message === "string" ? answer.message : `testing.${command}: the page refused`;
	return code === "not-implemented" && typeof answer.requires === "string"
		? { ok: false, code, message, requires: answer.requires }
		: { ok: false, code, message };
}

/** Wait one interval without pulling a timer library in; `waitFor` is the only caller. */
export function pause(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
