/**
 * The page-facing commands of `crust:accessibility`: `announce`, `title` and `focus`. Split from
 * `accessibility.ts` so that file stays the composition root and this one holds the three handlers a
 * page calls, with the rule each one follows written beside it.
 *
 * `announce` is deliberately not gated on `trusted`. An untrusted process still posts the notification
 * and the OS drops it, so the honest answer is `announced: true` with the trust state beside it —
 * refusing would claim a policy the OS does not apply. A platform with no announcement call at all is a
 * different statement, and that one answers `not-implemented` naming the call.
 */

import { type NotImplemented, notImplemented } from "./define";
import {
	type AccessibilityAdapter,
	type AccessibilityFailure,
	type AnnouncePriority,
	priorityOf,
} from "./accessibility-types";

/** `announced` is the post; `trusted` the state that decided whether the OS would speak it. */
export interface AnnounceResult {
	ok: true;
	announced: boolean;
	trusted: boolean | undefined;
	priority: AnnouncePriority;
	reason: string;
}

export interface TitleResult {
	ok: true;
	titled: boolean;
	reason: string;
}

export interface FocusResult {
	ok: true;
	focused: boolean;
	reason: string;
}

/** The `announce` arguments as a page sends them: text plus an optional priority. */
export interface AnnounceArgs {
	text?: string;
	priority?: string;
}

/** The `title` arguments: the name to set, and which window to name. */
export interface TitleArgs {
	text?: string;
	label?: string;
}

/** The `focus` arguments: which window to move to; no label means the key window. */
export interface FocusArgs {
	label?: string;
}

export interface PageCommandResults {
	announce: (
		args: AnnounceArgs | undefined,
	) => Promise<AnnounceResult | AccessibilityFailure | NotImplemented>;
	title: (
		args: TitleArgs | undefined,
	) => Promise<TitleResult | AccessibilityFailure | NotImplemented>;
	focus: (
		args: FocusArgs | undefined,
	) => Promise<FocusResult | AccessibilityFailure | NotImplemented>;
}

function refused(error: unknown): AccessibilityFailure {
	return {
		ok: false,
		code: "handler-error",
		message: error instanceof Error ? error.message : String(error),
	};
}

/** The three refusals a handler can answer before any native call is made. */
export interface PageGuards {
	/** No adapter at all: this platform has no accessibility half. */
	missing(command: string): NotImplemented;
	/** An adapter without the method: the app chose not to carry this surface. */
	unsupported(command: "announce" | "title" | "focus"): NotImplemented;
}

const emptyText = (command: string, field: string): AccessibilityFailure => ({
	ok: false,
	code: "bad-request",
	message: `accessibility.${command} needs a non-empty \`${field}\``,
});

export function pageCommands(
	adapter: AccessibilityAdapter | undefined,
	guards: PageGuards,
): PageCommandResults {
	return {
		/** Speak `text` through the platform. An untrusted process still posts; the OS drops it. */
		announce: async (
			args: AnnounceArgs | undefined,
		): Promise<AnnounceResult | AccessibilityFailure | NotImplemented> => {
			if (!adapter) return guards.missing("announce");
			const announce = adapter.announce;
			if (!announce) return guards.unsupported("announce");
			const text = typeof args?.text === "string" ? args.text : "";
			if (text.length === 0) return emptyText("announce", "text");
			const priority = priorityOf(args?.priority);
			try {
				const report = await announce(text, priority);
				const trusted = adapter.trusted ? await adapter.trusted() : undefined;
				return {
					ok: true,
					announced: report.announced,
					trusted,
					priority,
					reason: report.reason,
				};
			} catch (error) {
				return refused(error);
			}
		},

		/** Set the window's accessible name — what a screen reader reads on focus. */
		title: async (
			args: TitleArgs | undefined,
		): Promise<TitleResult | AccessibilityFailure | NotImplemented> => {
			if (!adapter) return guards.missing("title");
			const title = adapter.title;
			if (!title) return guards.unsupported("title");
			const text = typeof args?.text === "string" ? args.text : "";
			if (text.length === 0) return emptyText("title", "text");
			try {
				const report = await title(text, args?.label);
				return { ok: true, titled: report.titled, reason: report.reason };
			} catch (error) {
				return refused(error);
			}
		},

		/** Move assistive focus to a window: no label means the app's key window. */
		focus: async (
			args: FocusArgs | undefined,
		): Promise<FocusResult | AccessibilityFailure | NotImplemented> => {
			if (!adapter) return guards.missing("focus");
			const focus = adapter.focus;
			if (!focus) return guards.unsupported("focus");
			try {
				const report = await focus(args?.label);
				if (!report.focused) {
					// The native adapter reports "no AX window matched" when the caller named no
					// window that exists. That is the caller's mistake and the documented bad-request
					// branch; a different reason is a native fault, not a bad label.
					const unknown = /no (?:AX )?window matched/i.test(report.reason);
					return {
						ok: false,
						code: unknown ? "bad-request" : "handler-error",
						message: `accessibility.focus: ${report.reason}`,
					};
				}
				return { ok: true, focused: report.focused, reason: report.reason };
			} catch (error) {
				// An unknown label is the caller's own mistake, so it stays `bad-request`.
				const failure = refused(error);
				const name = (error as { name?: string } | undefined)?.name;
				return name === "CrustError" ? { ...failure, code: "bad-request" } : failure;
			}
		},
	};
}

/** The honest default, for a caller that only wants the refusals named. */
export function noAdapter(command: string, requires: string): NotImplemented {
	return notImplemented(
		`accessibility.${command} has no native half on this platform. Needs ${requires}.`,
		requires,
	);
}
