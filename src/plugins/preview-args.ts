/**
 * `preview.show`'s arguments. A preview is a file read, so the path is absolute before anything
 * else looks at it: a relative path would resolve against whatever directory the process happens to
 * have, which is not a file the page chose. Size is both-or-neither, because one side alone sized
 * the panel blank (the C unit ignores a one-sided request for the same reason).
 */
import { isAbsolute } from "node:path";

import { CrustError } from "../bridge/errors";

export interface ShowArgs {
	path?: unknown;
	width?: unknown;
	height?: unknown;
}

/** What the config's `preview` section supplies when the page passes no size. 0 means "the panel's own". */
export interface ShowDefaults {
	width?: number;
	height?: number;
}

export interface ResolvedShow {
	path: string;
	width: number;
	height: number;
}

function positive(value: unknown, field: string): number | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		throw new CrustError(
			"bad-request",
			`preview.show: "${field}" must be a positive integer, got ${JSON.stringify(value)}`,
		);
	}
	return value;
}

/** The validated request, with the config's size as the fallback. Throws `bad-request` by name. */
export function readShow(args: unknown, defaults: ShowDefaults = {}): ResolvedShow {
	const input = (typeof args === "object" && args !== null ? args : {}) as ShowArgs;
	if (typeof input.path !== "string" || input.path.length === 0) {
		throw new CrustError("bad-request", 'preview.show: "path" must be a non-empty string');
	}
	if (!isAbsolute(input.path)) {
		throw new CrustError(
			"bad-request",
			`preview.show: ${JSON.stringify(input.path)} is not an absolute path`,
		);
	}
	const width = positive(input.width, "width");
	const height = positive(input.height, "height");
	if ((width === undefined) !== (height === undefined)) {
		throw new CrustError(
			"bad-request",
			"preview.show: pass both width and height or neither; a one-sided size makes a blank panel",
		);
	}
	const sized = width !== undefined && height !== undefined;
	return {
		path: input.path,
		width: sized ? width : (defaults.width ?? 0),
		height: sized ? height : (defaults.height ?? 0),
	};
}
