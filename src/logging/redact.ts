/**
 * The redaction pass: secrets leave the process as `[redacted]`, never as a value.
 *
 * Two halves, because a credential hides in two places. Fields are redacted by *name*, and the names
 * are curated rather than merely "contains key": a field called `keys`, `key`, `publicKey` or
 * `keyCount` keeps its value, because a bare `key` is as often a lookup table as a credential and
 * over-redaction destroys a caller's data with nothing to recover it. The message is redacted by
 * *shape*, because a URL can carry the credential in its query string (`?token=…`) — that half stays
 * broad. A field value that is a string goes through the text pass too: a URL logged under `url` is
 * the same leak.
 */

export const REDACTED = "[redacted]";

/**
 * Whole words that are a secret whatever they sit next to. Split into words first, so a plural is
 * the same word (`tokens` → `token`) while `keys` → `key` deliberately lands outside the set.
 */
const SECRET_WORDS = new Set([
	"token",
	"secret",
	"password",
	"passwd",
	"passphrase",
	"credential",
	"credentials",
	"authorization",
	"auth",
	"bearer",
	"jwt",
	"assertion",
	"session",
	"cookie",
	"keychain",
	"seed",
	"sid",
]);

/**
 * Compounds whose last word is a bare `key`, so the word set alone would miss them: `apiKey`,
 * `api_key`, `privateKey`, `private_key`, `keyChain`. A name is matched on its joined words, so
 * every spelling lands on the same form.
 */
const SECRET_COMPOUNDS = ["apikey", "privatekey", "keychain", "refreshtoken"];

/** camelCase, snake_case, kebab-case and dotted names all become space-separated lower-case words. */
function words(name: string): string[] {
	return name
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.split(/[^a-zA-Z0-9]+/)
		.filter((word) => word.length > 0)
		.map((word) => word.toLowerCase());
}

/** A word, or its singular: plural is how `keys` used to be swallowed and must not be. */
function isSecretWord(word: string): boolean {
	if (SECRET_WORDS.has(word)) return true;
	return word.endsWith("s") && SECRET_WORDS.has(word.slice(0, -1));
}

export function isSecretName(name: string): boolean {
	const parts = words(name);
	if (parts.length === 0) return false;
	const joined = parts.join("");
	if (SECRET_COMPOUNDS.some((compound) => joined.endsWith(compound)))
		return true;
	return parts.some(isSecretWord);
}

/**
 * Query keys are built from the same vocabulary as field names, in every spelling a URL uses. A
 * curated shorter list left `?apiKey=`, `?jwt=` and `?refresh_token=` in messages unchanged.
 */
const QUERY_KEYS = [
	"token",
	"key",
	"secret",
	"password",
	"passwd",
	"passphrase",
	"credential",
	"credentials",
	"api_key",
	"apiKey",
	"apikey",
	"access_token",
	"accessToken",
	"accesstoken",
	"private_key",
	"privateKey",
	"privatekey",
	"refresh_token",
	"refreshToken",
	"refreshtoken",
	"jwt",
	"session",
	"sessionid",
	"auth",
	"authorization",
	"bearer",
	"assertion",
];
const QUERY = new RegExp(`([?&](?:${QUERY_KEYS.join("|")})=)[^&#\\s"']+`, "gi");
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const BASIC = /\b(Authorization\s*:\s*Basic\s+)[A-Za-z0-9+/=]+/gi;
const COOKIE = /\b(Cookie\s*:\s*)[^\r\n;]+/gi;
const JSON_PAIR =
	/("(?:token|secret|password|key|authorization|apiKey|api_key|privateKey|private_key|jwt|refreshToken|refresh_token)"\s*:\s*")[^"]*"/gi;

/** Replace every credential-looking substring with {@link REDACTED}. */
export function redactText(text: string): string {
	return text
		.replace(QUERY, `$1${REDACTED}`)
		.replace(BEARER, `Bearer ${REDACTED}`)
		.replace(BASIC, `$1${REDACTED}`)
		.replace(COOKIE, `$1${REDACTED}`)
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
		return text.length > MAX_STRING
			? `${text.slice(0, MAX_STRING)}…[truncated]`
			: text;
	}
	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		value === null
	)
		return value;
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "undefined" || typeof value === "function")
		return undefined;
	if (typeof value === "symbol") return String(value);
	if (depth >= MAX_DEPTH) return "[depth]";
	if (Array.isArray(value)) {
		return value.map((item) => redactValue(item, key, depth + 1));
	}
	if (value instanceof Error) {
		return {
			name: value.name,
			message: redactText(value.message),
			// stack[0] is "Error: " + message: redacting the message alone leaks the same credential
			// one line down. Every retained frame goes through the same text pass.
			stack: value.stack?.split("\n").slice(0, 5).map((line) => redactText(line)),
		};
	}
	if (value instanceof Uint8Array) return `[bytes ${value.byteLength}]`;
	const out: Record<string, unknown> = {};
	for (const [name, item] of Object.entries(
		value as Record<string, unknown>,
	)) {
		const next = redactValue(item, name, depth + 1);
		if (next !== undefined) out[name] = next;
	}
	return out;
}

/** Every field redacted, one level of keys. */
export function redactFields(
	fields: Record<string, unknown> = {},
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [name, value] of Object.entries(fields)) {
		const next = redactValue(value, name);
		if (next !== undefined) out[name] = next;
	}
	return out;
}
