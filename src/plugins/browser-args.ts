/**
 * Argument reading for `crust:browser`, kept apart so the five command handlers stay short. Every
 * refusal is a `bad-request` that names the argument and what arrived, because the caller can fix
 * all of them without touching the native side.
 */
import type { BrowserBounds, BrowserFailure } from "./browser-types";

/** A required, non-empty string argument. */
export function readText(args: unknown, key: string, command: string): string | BrowserFailure {
	const value =
		typeof args === "object" && args !== null
			? (args as Record<string, unknown>)[key]
			: undefined;
	if (typeof value !== "string" || value.length === 0) {
		return {
			ok: false,
			code: "bad-request",
			message: `browser.${command}: ${key} must be a non-empty string, got ${JSON.stringify(value)}`,
		};
	}
	return value;
}

/** A finite number, with a fallback for an omitted optional coordinate. */
function numberAt(
	box: Record<string, unknown>,
	key: string,
	fallback: number | undefined,
): number | undefined {
	const value = box[key];
	if (value === undefined) return fallback;
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const BOUND_KEYS = ["x", "y", "width", "height"] as const;

/**
 * `{ x, y, width, height }`, either nested under `bounds` or flat on the arguments. `x` and `y`
 * default to 0 so a surface can be placed flush with the window edge; `width` and `height` are
 * required because a zero-sized surface is invisible and reads as a failure.
 */
export function readBounds(args: unknown, command: string): BrowserBounds | BrowserFailure {
	const outer =
		typeof args === "object" && args !== null ? (args as Record<string, unknown>) : undefined;
	const nested = outer?.bounds;
	const box =
		typeof nested === "object" && nested !== null ? (nested as Record<string, unknown>) : outer;
	if (box === undefined) {
		return {
			ok: false,
			code: "bad-request",
			message: `browser.${command}: bounds must be an object with ${BOUND_KEYS.join(", ")}, got ${JSON.stringify(nested)}`,
		};
	}
	const x = numberAt(box, "x", 0);
	const y = numberAt(box, "y", 0);
	const width = numberAt(box, "width", undefined);
	const height = numberAt(box, "height", undefined);
	if (x === undefined || y === undefined || width === undefined || height === undefined) {
		return {
			ok: false,
			code: "bad-request",
			message:
				`browser.${command}: bounds needs finite numbers for ${BOUND_KEYS.join(", ")}; ` +
				`got ${JSON.stringify({ x: box.x, y: box.y, width: box.width, height: box.height })}`,
		};
	}
	if (width <= 0 || height <= 0) {
		return {
			ok: false,
			code: "bad-request",
			message: `browser.${command}: bounds width and height must be greater than 0, got ${width}x${height}`,
		};
	}
	return { x, y, width, height };
}
