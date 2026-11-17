/**
 * Binary command results cross the one JSON envelope rather than a second content type: a
 * `Uint8Array` becomes `{ __crustBytes: base64 }` and the page client revives it. A JSON walk is
 * what keeps every non-binary answer byte-identical, which an octet-stream body could not do for a
 * result that is only partly bytes (`clipboard.readImage` answers `{ ok, png }`).
 *
 * The tag is a reserved key, so ordinary data must be able to survive carrying it: an object whose
 * own keys include either tag is wrapped as `{ __crustLiteral: <the object> }`, and the page client
 * returns that payload verbatim. Without the escape an `echo` of `{ __crustBytes: "aGVsbG8=" }`
 * comes back as bytes, and a `__proto__` field would set the prototype instead of surviving.
 */

/** The tag the page client looks for. It is a literal there, because that source is serialised. */
export const BYTES_KEY = "__crustBytes";

/** The escape for a real data object that happens to carry a tag key. Also a literal in the client. */
export const LITERAL_KEY = "__crustLiteral";

/** Depth 1 covers bytes as the whole result and bytes as one property of it. */
const MAX_DEPTH = 1;

function base64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("base64");
}

function encode(value: Uint8Array): Record<string, string> {
	return { [BYTES_KEY]: base64(value) };
}

/** Assign without letting a `__proto__` key walk the prototype chain. */
function put(out: Record<string, unknown>, key: string, value: unknown): void {
	Object.defineProperty(out, key, {
		value,
		enumerable: true,
		writable: true,
		configurable: true,
	});
}

/** A data object carrying a tag key, wrapped so the client hands it back untouched. */
function escapeLiteral(value: Record<string, unknown>, depth: number): Record<string, unknown> {
	const payload: Record<string, unknown> = {};
	for (const key of Object.keys(value)) put(payload, key, encodeResult(value[key], depth + 1));
	const out: Record<string, unknown> = {};
	put(out, LITERAL_KEY, payload);
	return out;
}

export function encodeResult(value: unknown, depth = 0): unknown {
	if (depth > MAX_DEPTH || value === null || typeof value !== "object") return value;
	if (value instanceof Uint8Array) return encode(value);
	if (Array.isArray(value)) {
		const items = value.map((item) => encodeResult(item, depth + 1));
		return items.some((item, index) => item !== value[index]) ? items : value;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.includes(BYTES_KEY) || keys.includes(LITERAL_KEY)) {
		return escapeLiteral(record, depth);
	}
	const out: Record<string, unknown> = {};
	let changed = false;
	for (const key of keys) {
		const next = encodeResult(record[key], depth + 1);
		put(out, key, next);
		if (next !== record[key]) changed = true;
	}
	return changed ? out : value;
}
