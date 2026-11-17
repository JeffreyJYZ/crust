/**
 * `crust:navigation`'s window reading: which window a command names, and what a refusal
 * answers. Split from `navigation.ts` so the six command handlers stay readable and the one
 * rule they all share — a label is validated before any native call, and a label that names
 * no open window keeps the resolver's `bad-request` instead of being flattened — lives in a
 * single place.
 */

import { CrustError } from "../bridge/errors";
import type { NavigationFailure } from "./navigation-types";

/** An adapter throw, reduced to a value. `bad-request` is the one code kept as it arrived. */
export function failure(error: unknown): NavigationFailure {
	// The resolver refuses an unknown label with `bad-request`. Flattening that into
	// `handler-error` would hide the one thing the caller can fix.
	if (error instanceof CrustError && error.code === "bad-request") {
		return { ok: false, code: "bad-request", message: error.message };
	}
	return {
		ok: false,
		code: "handler-error",
		message: error instanceof Error ? error.message : String(error),
	};
}

/** A label that is present but unusable, refused before any native call is sent. */
export function badLabel(seen: unknown): NavigationFailure {
	return {
		ok: false,
		code: "bad-request",
		message: `crust: navigation label must be a non-empty string when given, got ${JSON.stringify(seen)}`,
	};
}

/**
 * The window a command names. An absent argument or an absent `label` is `{}`, which the
 * adapter reads as the app's first open window — the single-window meaning, unchanged.
 */
export function target(args: unknown): { label?: string } | NavigationFailure {
	if (args === undefined || args === null) return {};
	if (typeof args !== "object") return badLabel(args);
	const label = (args as { label?: unknown }).label;
	if (label === undefined) return {};
	if (typeof label !== "string" || label.length === 0) return badLabel(label);
	return { label };
}

/** A present but unusable URL, refused before any native load starts. */
function badUrl(seen: unknown): NavigationFailure {
	return {
		ok: false,
		code: "bad-request",
		message: `crust: navigation url must be a non-empty string, got ${JSON.stringify(seen)}`,
	};
}

/**
 * `loadUrl`'s arguments: the URL plus the window the shared `target` already resolves.
 * A malformed URL is the caller's error and keeps the resolver's `bad-request`.
 */
export function loadArgs(args: unknown): { url: string; label?: string } | NavigationFailure {
	const chosen = target(args);
	if ("ok" in chosen) return chosen;
	if (typeof args !== "object" || args === null) return badUrl(args);
	const url = (args as { url?: unknown }).url;
	if (typeof url !== "string" || url.length === 0) return badUrl(url);
	return { url, ...chosen };
}
