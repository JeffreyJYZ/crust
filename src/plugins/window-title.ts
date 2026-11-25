/**
 * The title validation shared by `window.create` and `window.setTitle`. Both refuse a non-string
 * with the same code, so a page can name the bad argument without guessing which path produced it.
 */

import type { WindowFailure } from "./window-types.ts";

/** A title is a string or the command refuses; no coercion reaches the native setter. */
export function invalidTitle(
	label: string,
	value: unknown,
	command: "create" | "setTitle",
): WindowFailure {
	return {
		ok: false,
		code: "invalid-title",
		message: `crust: window.${command} title must be a string, got ${JSON.stringify(value)}`,
		label,
	};
}
