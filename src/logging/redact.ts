/**
 * The redaction pass: secrets leave the process as `[redacted]`, never as a value.
 *
 * Two halves, because a credential hides in two places. Fields are redacted by *name* — a key
 * called `token`, `seedToken`, `apiKey`, `password`, `authorization` or `cookie` loses its value
 * whatever it holds. The message is redacted by *shape*, because a URL can carry the credential in
 * its query string (`?token=…`), and a page's own text can carry `Bearer …`. A field value that is
 * a string goes through the text pass too: a URL logged under `url` is the same leak.
 */

export const REDACTED = "[redacted]";

/**
 * A name that is a secret, split into words first so `apiKey` and `seed_token` are two words while
 * `monkey` is one. Boundaries on both sides keep `monkey` and `keyboard` readable.
 */
const SECRET_WORD =
	/(^|[^a-z0-9])(token|secret|password|passwd|key|authorization|cookie|credential)s?([^a-z0-9]|$)/;

/** camelCase and snake_case both become space-separated words before the match. */
function words(name: string): string {
	return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

export function isSecretName(name: string): boolean {
	return SECRET_WORD.test(words(name));
}

/** Query pairs, JSON pairs and an authorization header, the three shapes a message can carry. */
const QUERY = /([?&](?:token|key|secret|password|api_key|access_token)=)[^&#\s"']+/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JSON_PAIR = /("(?:token|secret|password|key|authorization)"\s*:\s*")[^"]*"/gi;

/** Replace every credential-looking substring with {@link REDACTED}. */
export function redactText(text: string): string {
	return text
		.replace(QUERY, `$1${REDACTED}`)
		.replace(BEARER, `Bearer ${REDACTED}`)
		.replace(JSON_PAIR, `$1${REDACTED}"`);
}

const MAX_DEPTH = 6;
const MAX_STRING = 2000;

/**
 * One value, redacted: a secret-named key loses the whole value, a string still loses its query
 * token, and a structure is walked to {@link MAX_DEPTH}. A string is truncated because a page can
 * log a megabyte and the log must stay readable; the truncation is marked, never silent.
 */
export function redactValue(value: unknown, key = "", depth = 0): unknown {
	if (isSecretName(key)) return REDACTED;
	if (typeof value === "string") {
		const text = redactText(value);
		return text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}…[truncated]` : text;
	}
	if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "undefined" || typeof value === "function") return undefined;
	if (typeof value === "symbol") return String(value);
	if (depth >= MAX_DEPTH) return "[depth]";
	if (Array.isArray(value)) {
		return value.map((item) => redactValue(item, key, depth + 1));
	}
	if (value instanceof Error) {
		return {
			name: value.name,
			message: redactText(value.message),
			stack: value.stack?.split("\n").slice(0, 5),
		};
	}
	if (value instanceof Uint8Array) return `[bytes ${value.byteLength}]`;
	const out: Record<string, unknown> = {};
	for (const [name, item] of Object.entries(value as Record<string, unknown>)) {
		const next = redactValue(item, name, depth + 1);
		if (next !== undefined) out[name] = next;
	}
	return out;
}

/** Every field redacted, one level of keys. */
export function redactFields(fields: Record<string, unknown> = {}): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [name, value] of Object.entries(fields)) {
		const next = redactValue(value, name);
		if (next !== undefined) out[name] = next;
	}
	return out;
}
