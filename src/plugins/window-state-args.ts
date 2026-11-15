/**
 * What a state command's payload must be, and the typed failures it earns. A page payload is whatever the bridge parsed, so every reader answers a typed refusal rather than throwing and nothing here touches an adapter. `invalidSize` is shared with `window.create`; the position and flag codes exist only for these commands.
 */

import { invalidSize } from "./window-args.ts";
import type { WindowPoint, WindowSize } from "./window-state-types.ts";
import type { WindowFailure } from "./window-types.ts";

type Read<Value> = { ok: true; value: Value } | { ok: false; failure: WindowFailure };

/** A width and a height, each a positive integer, never clamped. */
export function readSize(args: unknown, command = "setSize"): Read<WindowSize> {
	const source = (typeof args === "object" && args !== null ? args : {}) as {
		width?: unknown;
		height?: unknown;
	};
	const width = source.width;
	const height = source.height;
	// Refused, not clamped: a page asking for 0 or 12.5 has a bug, and a silently
	// resized window hides it. Same rule as `window.create`.
	if (typeof width !== "number" || !Number.isInteger(width) || width <= 0) {
		return { ok: false, failure: invalidSize(args, "width", width, command) };
	}
	if (typeof height !== "number" || !Number.isInteger(height) || height <= 0) {
		return { ok: false, failure: invalidSize(args, "height", height, command) };
	}
	return { ok: true, value: { width, height } };
}

/** An x and a y, each an integer; negative is a real position, so it is allowed. */
export function readPoint(args: unknown): Read<WindowPoint> {
	const source = (typeof args === "object" && args !== null ? args : {}) as {
		x?: unknown;
		y?: unknown;
	};
	const x = source.x;
	const y = source.y;
	if (typeof x !== "number" || !Number.isInteger(x)) {
		return { ok: false, failure: invalidPosition(args, "x", x) };
	}
	if (typeof y !== "number" || !Number.isInteger(y)) {
		return { ok: false, failure: invalidPosition(args, "y", y) };
	}
	return { ok: true, value: { x, y } };
}

/** A boolean, never a truthy stand-in: `"false"` would read as on. */
export function readFlag(args: unknown): Read<boolean> {
	const value =
		typeof args === "object" && args !== null ? (args as { value?: unknown }).value : undefined;
	if (typeof value !== "boolean") return { ok: false, failure: invalidValue(args, value) };
	return { ok: true, value };
}

export function invalidPosition(args: unknown, key: "x" | "y", value: unknown): WindowFailure {
	return {
		ok: false,
		code: "invalid-position",
		message:
			`crust: window.setPosition ${key} must be an integer, got ${JSON.stringify(value)}` +
			` in ${JSON.stringify(args)}`,
	};
}

export function invalidValue(args: unknown, value: unknown): WindowFailure {
	return {
		ok: false,
		code: "invalid-value",
		message:
			`crust: window command needs { label, value } with a boolean value, got ` +
			`${JSON.stringify(value)} in ${JSON.stringify(args)}`,
	};
}

/** An adapter that predates this command: named, not silently skipped. */
export function unknownAdapter(command: string, member: string): WindowFailure {
	return {
		ok: false,
		code: "unknown-adapter",
		message:
			`crust: this window adapter does not implement ${member}, which window.${command} needs. ` +
			"On macOS darwinWindowAdapter(platform) supplies it from window-state-adapter.ts.",
	};
}
