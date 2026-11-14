/**
 * `crust:window`'s argument reading and typed failures. A page payload is whatever the bridge parsed, never a checked value, so every reader answers `undefined` rather than throwing and every failure is a shape a page can branch on. Nothing here touches an adapter.
 */

import { notImplemented, type NotImplemented } from "./define";
import {
	WindowAdapterError,
	type WindowCreateOptions,
	type WindowFailure,
	type WindowNative,
} from "./window-types.ts";

/** The not-implemented answer, naming the selector a platform would need. */
export function missingWindow(command: string): NotImplemented {
	return notImplemented(
		`window.${command} needs NSWindow, which the AppKit shim does not expose here. ` +
			"Pass a WindowNative adapter to createWindowPlugin on a platform that has one.",
		"NSWindow",
	);
}

/**
 * A page payload is whatever the bridge parsed, so the label is read
 * defensively: a missing or non-string label is its own typed error.
 */
export function readLabel(args: unknown): string | undefined {
	if (typeof args !== "object" || args === null) return undefined;
	const value = (args as { label?: unknown }).label;
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function invalidLabel(args: unknown): WindowFailure {
	const seen = typeof args === "object" && args !== null ? JSON.stringify(args) : String(args);
	return {
		ok: false,
		code: "invalid-label",
		message: `crust: window command needs { label } with a non-empty string, got ${seen}`,
	};
}

/** Any adapter throw becomes a value; nothing escapes into the bridge. */
export function failure(error: unknown, label?: string): WindowFailure {
	const code = error instanceof WindowAdapterError ? error.code : "handler-error";
	const message = error instanceof Error ? error.message : String(error);
	return label === undefined ? { ok: false, code, message } : { ok: false, code, message, label };
}

export function unknownWindow(label: string): WindowFailure {
	return {
		ok: false,
		code: "unknown-window",
		message: `crust: no window labelled ${JSON.stringify(label)}`,
		label,
	};
}

/** A label already in the platform's map would be replaced, not added. */
export function duplicateLabel(label: string): WindowFailure {
	return {
		ok: false,
		code: "duplicate-label",
		message:
			`crust: a window labelled ${JSON.stringify(label)} already exists; ` +
			"a second one would replace it in the platform's map. Close it or pick another label.",
		label,
	};
}

export function invalidSize(args: unknown, key: "width" | "height", value: unknown): WindowFailure {
	return {
		ok: false,
		code: "invalid-size",
		message:
			`crust: window.create ${key} must be a positive integer, got ${JSON.stringify(value)}` +
			` in ${JSON.stringify(args)}`,
	};
}

export function invalidUrl(args: unknown, value: unknown): WindowFailure {
	return {
		ok: false,
		code: "invalid-url",
		message:
			`crust: window.create url must be a non-empty string when given, got ` +
			`${JSON.stringify(value)} in ${JSON.stringify(args)}`,
	};
}

/** `window.create`'s payload, or the typed reason it cannot be one. */
export function parseCreate(
	args: unknown,
): { ok: true; options: WindowCreateOptions } | { ok: false; failure: WindowFailure } {
	const label = readLabel(args);
	if (label === undefined) return { ok: false, failure: invalidLabel(args) };
	const source = args as { title?: unknown; width?: unknown; height?: unknown; url?: unknown };
	const options: WindowCreateOptions = { label };

	// An absent title is the platform's default; a present non-string is refused
	// here so the adapter never receives an argument it would coerce.
	if (source.title !== undefined) {
		if (typeof source.title !== "string") {
			return {
				ok: false,
				failure: {
					ok: false,
					code: "invalid-label",
					message:
						"crust: window.create title must be a string when given, got " +
						`${JSON.stringify(source.title)}`,
					label,
				},
			};
		}
		options.title = source.title;
	}

	// Refused, not clamped: a page that asks for 0 or 12.5 has a bug, and a
	// silently resized window hides it. Same rule as config's `positiveInteger`.
	for (const key of ["width", "height"] as const) {
		const value = source[key];
		if (value === undefined) continue;
		if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
			return { ok: false, failure: invalidSize(args, key, value) };
		}
		options[key] = value;
	}

	// An empty string is not "the app's own document"; it is a page bug that
	// would otherwise reach NSURL as nothing at all.
	if (source.url !== undefined) {
		if (typeof source.url !== "string" || source.url.length === 0) {
			return { ok: false, failure: invalidUrl(args, source.url) };
		}
		options.url = source.url;
	}

	return { ok: true, options };
}

/**
 * A label the adapter does not list is unknown before any selector is sent.
 * Liveness is the adapter's call; existence is answered here so the typed
 * error does not depend on every adapter remembering to throw.
 */
export function knownWindow(native: WindowNative, label: string): WindowFailure | undefined {
	return native.list().includes(label) ? undefined : unknownWindow(label);
}
