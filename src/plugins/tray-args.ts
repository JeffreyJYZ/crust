/**
 * `crust:tray`'s argument reading, typed failures and click relay.
 *
 * A page payload is whatever the bridge parsed, so each argument is read
 * defensively and each refusal is a value a page can branch on. Nothing here
 * touches an adapter.
 */

import { TrayAdapterError, type TrayFailure, type TrayMenuItem } from "./tray-types.ts";

/** Any adapter throw becomes a value; nothing escapes into the bridge. */
export function failure(error: unknown): TrayFailure {
	const code = error instanceof TrayAdapterError ? error.code : "handler-error";
	const message = error instanceof Error ? error.message : String(error);
	return { ok: false, code, message };
}

export function invalidText(args: unknown): TrayFailure {
	const seen = typeof args === "object" && args !== null ? JSON.stringify(args) : String(args);
	return {
		ok: false,
		code: "invalid-text",
		message: `crust: tray.setTitle needs { text } with a string, got ${seen}`,
	};
}

export function invalidMenu(args: unknown, reason: string): TrayFailure {
	const seen = typeof args === "object" && args !== null ? JSON.stringify(args) : String(args);
	return {
		ok: false,
		code: "invalid-menu",
		message: `crust: tray.setMenu ${reason}, got ${seen}`,
	};
}

/**
 * A page payload is whatever the bridge parsed, so each argument is read
 * defensively: a missing or wrong-typed value is its own typed error rather
 * than a `TypeError` from deep inside the adapter.
 */
export function readText(args: unknown): string | undefined {
	if (typeof args !== "object" || args === null) return undefined;
	const value = (args as { text?: unknown }).text;
	return typeof value === "string" ? value : undefined;
}

/** Every row needs a non-empty label; a handler is optional and must be a function. */
export function readItems(args: unknown): TrayMenuItem[] | string {
	if (typeof args !== "object" || args === null) return "needs { items }";
	const value = (args as { items?: unknown }).items;
	if (!Array.isArray(value)) return "needs { items } with an array";
	const items: TrayMenuItem[] = [];
	for (let index = 0; index < value.length; index++) {
		const entry: unknown = value[index];
		if (typeof entry !== "object" || entry === null)
			return `needs item ${index} to be an object`;
		const label = (entry as { label?: unknown }).label;
		if (typeof label !== "string" || label.length === 0) {
			return `needs item ${index} to carry a non-empty label`;
		}
		const onClick = (entry as { onClick?: unknown }).onClick;
		if (onClick !== undefined && typeof onClick !== "function") {
			return `needs item ${index}.onClick to be a function when given`;
		}
		items.push({ label, onClick: onClick as (() => void) | undefined });
	}
	return items;
}

export function emitClick(ctx: unknown, payload: { index: number; label: string }): void {
	if (typeof ctx !== "object" || ctx === null) return;
	const emit = (ctx as { emit?: unknown }).emit;
	if (typeof emit !== "function") return;
	try {
		(emit as (event: string, data: unknown) => void).call(ctx, "tray:click", payload);
	} catch {
		// A page listener must never turn a click into an exception inside AppKit.
	}
}
