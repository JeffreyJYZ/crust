/**
 * `crust:findinpage` — the webview's own find, so a page's search bar can use the same highlight and scroll WebKit gives ⌘F. WebKit's `-findString:withConfiguration:completionHandler:` is the only public entry point, so this module owns no framework: macOS supplies `darwinFindAdapter()` and a platform with no find API keeps answering a typed `NotImplemented`.
 * `matches` is `1` or `0`, never a total: `WKFindResult` carries `-matchFound` and nothing else, and a real count needs a private selector this module does not send.
 * Every command takes an optional `{ label }`, read before the adapter runs and passed to it last, so a page can search a second window; omitted means the app's first open window, and a label naming no open window keeps the resolver's `bad-request` rather than searching the wrong page.
 * `clear()` is the honest case. WebKit has no public way to drop the find indicator, so it answers `notImplemented` naming the private `-_clearFindIndicator` rather than calling it silently.
 */

import { CrustError } from "../bridge/errors";
import { definePlugin, notImplemented, type NotImplemented, type PluginDefinition } from "./define";

/** What to look for. `forward` and `matchCase` default to `true` and `false`. */
export interface FindQuery {
	text: string;
	forward?: boolean;
	matchCase?: boolean;
}

/**
 * Which window's webview runs the search. Omitted means the app's first open window, which is
 * what a single-window caller has always meant; a label naming no open window is `bad-request`
 * naming it, never a silent fall back to that first window.
 */
export interface FindArgs {
	label?: string;
}

/** `search`'s payload: what to look for, and where. */
export interface FindSearchArgs extends FindQuery {
	label?: string;
}

/** WebKit's answer. `matches` is 1 when the search found something, 0 when it did not. */
export interface FindOutcome {
	matches: number;
	found: boolean;
}

/** A refused search: the native half could not start it, or never answered. */
export interface FindFailure {
	ok: false;
	code: "handler-error";
	message: string;
}

/**
 * The native half. It owns the webview; the plugin owns the argument checks. Every member takes
 * the window label last, so the plugin can aim one search at one window.
 */
export interface FindAdapter {
	search(
		query: { text: string; forward: boolean; matchCase: boolean },
		label?: string,
	): Promise<FindOutcome>;
	next(label?: string): Promise<FindOutcome>;
	previous(label?: string): Promise<FindOutcome>;
	/** Optional: a platform with a public clear provides one, macOS does not. */
	clear?(label?: string): void;
}

/** The private selector macOS would need, named so a caller can see what is missing. */
const CLEAR_SELECTOR = "WKWebView -_clearFindIndicator";

function requireText(value: unknown): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new CrustError("bad-request", 'findinpage.search: "text" must be a non-empty string');
	}
	return value;
}

function requireFlag(value: unknown, field: string, fallback: boolean): boolean {
	if (value === undefined) return fallback;
	if (typeof value !== "boolean") {
		throw new CrustError("bad-request", `findinpage.search: "${field}" must be a boolean`);
	}
	return value;
}

/**
 * The window a command names. Absent is the app's first open window; a label that is present
 * but not a non-empty string is refused here, before any native call, so an unusable one can
 * never reach a selector.
 */
function requireLabel(args: unknown): string | undefined {
	if (typeof args !== "object" || args === null) return undefined;
	const value = (args as { label?: unknown }).label;
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.length === 0) {
		throw new CrustError(
			"bad-request",
			`findinpage: "label" must be a non-empty string when given, got ${JSON.stringify(value)}`,
		);
	}
	return value;
}

/** An adapter that threw, or a promise that rejected, is a typed failure. */
async function answered(call: () => Promise<FindOutcome>): Promise<FindOutcome | FindFailure> {
	try {
		return await call();
	} catch (error) {
		// The resolver refuses an unknown label with `bad-request`; that is the bridge's own
		// refusal and the caller can fix it, so it keeps its code instead of becoming a 500.
		if (error instanceof CrustError && error.code === "bad-request") throw error;
		return {
			ok: false,
			code: "handler-error",
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

function outcome(answer: FindOutcome | FindFailure): (FindOutcome & { ok: true }) | FindFailure {
	return "ok" in answer ? answer : { ok: true, matches: answer.matches, found: answer.found };
}

export function createFindInPagePlugin(adapter?: FindAdapter): PluginDefinition<
	"findinpage",
	{
		search: (
			args: FindSearchArgs,
		) => Promise<(FindOutcome & { ok: true }) | FindFailure | NotImplemented>;
		next: (
			args: FindArgs | undefined,
		) => Promise<(FindOutcome & { ok: true }) | FindFailure | NotImplemented>;
		previous: (
			args: FindArgs | undefined,
		) => Promise<(FindOutcome & { ok: true }) | FindFailure | NotImplemented>;
		clear: (args: FindArgs | undefined) => { ok: true; cleared: true } | NotImplemented;
	}
> {
	const native = adapter;
	const missing = (command: string) =>
		notImplemented(
			`findinpage.${command} needs -[WKWebView findString:withConfiguration:completionHandler:], which only WebKit provides. Pass a FindAdapter to createFindInPagePlugin on a platform that has no find API.`,
			"WKWebView -findString:withConfiguration:completionHandler:",
		);

	return definePlugin({
		name: "findinpage",
		commands: {
			/** Search one window's page, highlight the first match and scroll it into view. */
			search: async (
				args: FindSearchArgs,
			): Promise<(FindOutcome & { ok: true }) | FindFailure | NotImplemented> => {
				if (!native) return missing("search");
				const label = requireLabel(args);
				const text = requireText(args?.text);
				const forward = requireFlag(args?.forward, "forward", true);
				const matchCase = requireFlag(args?.matchCase, "matchCase", false);
				return outcome(
					await answered(() => native.search({ text, forward, matchCase }, label)),
				);
			},
			/** The next match in the same direction, re-running that window's last search. */
			next: async (
				args: FindArgs | undefined,
			): Promise<(FindOutcome & { ok: true }) | FindFailure | NotImplemented> => {
				if (!native) return missing("next");
				const label = requireLabel(args);
				return outcome(await answered(() => native.next(label)));
			},
			/** The previous match, re-running that window's last search backwards. */
			previous: async (
				args: FindArgs | undefined,
			): Promise<(FindOutcome & { ok: true }) | FindFailure | NotImplemented> => {
				if (!native) return missing("previous");
				const label = requireLabel(args);
				return outcome(await answered(() => native.previous(label)));
			},
			/** Drop the highlight. No public selector exists on macOS, so this names the private one. */
			clear: (args: FindArgs | undefined): { ok: true; cleared: true } | NotImplemented => {
				if (!native?.clear) {
					return notImplemented(
						"findinpage.clear needs -[WKWebView _clearFindIndicator], a private selector with no public replacement; sending it from a public command would be a private API call made silently. An adapter with a public clear() answers instead.",
						CLEAR_SELECTOR,
					);
				}
				const label = requireLabel(args);
				native.clear(label);
				return { ok: true, cleared: true };
			},
		},
	});
}

/** The default registration: honest about the missing framework. */
export const findinpagePlugin = createFindInPagePlugin();
