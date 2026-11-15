/**
 * Binary command results cross the one JSON envelope rather than a second content type: a
 * `Uint8Array` becomes `{ __crustBytes: base64 }` and the page client revives it. A JSON walk is
 * what keeps every non-binary answer byte-identical, which an octet-stream body could not do for a
 * result that is only partly bytes (`clipboard.readImage` answers `{ ok, png }`).
 */

/** The tag the page client looks for. It is a literal there, because that source is serialised. */
export const BYTES_KEY = "__crustBytes";

/** Depth 1 covers bytes as the whole result and bytes as one property of it. */
const MAX_DEPTH = 1;

function base64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}

function encode(value: Uint8Array): Record<string, string> {
	return { [BYTES_KEY]: base64(value) };
}

export function encodeResult(value: unknown, depth = 0): unknown {
	if (depth > MAX_DEPTH || value === null || typeof value !== "object") return value;
	if (value instanceof Uint8Array) return encode(value);
	if (Array.isArray(value)) {
		const items = value.map((item) => encodeResult(item, depth + 1));
		return items.some((item, index) => item !== value[index]) ? items : value;
	}
	const record = value as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	let changed = false;
	for (const key of Object.keys(record)) {
		out[key] = encodeResult(record[key], depth + 1);
		if (out[key] !== record[key]) changed = true;
	}
	return changed ? out : value;
}
