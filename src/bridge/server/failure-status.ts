/**
 * A command may answer a typed failure value instead of throwing — `window`, `tray`, `database`,
 * `updater` and others use `{ ok: false, code, message }`. The bridge used to send every such value
 * with HTTP 200, so a caller that looked only at the transport could not tell a refusal from a
 * success. This maps the code onto the same status table `CrustError` uses and returns a non-200
 * status while the body keeps the typed value, so a page that checks `ok` receives exactly what it
 * received before and a caller that ignores the result is never given a new rejection.
 */

import { type CrustErrorCode, statusForCode } from "../errors";

/** Plugin failure codes that name a bridge-level condition, mapped to the CrustError table. */
const CONDITION: Record<string, CrustErrorCode> = {
	"invalid-label": "bad-request",
	"invalid-title": "bad-request",
	"invalid-size": "bad-request",
	"invalid-position": "bad-request",
	"invalid-value": "bad-request",
	"invalid-url": "bad-request",
	"invalid-text": "bad-request",
	"invalid-menu": "bad-request",
	"invalid-args": "bad-request",
	"duplicate-label": "bad-request",
	"not-an-app-bundle": "bad-request",
	"unknown-window": "not-found",
	destroyed: "not-found",
	"unknown-adapter": "not-implemented",
	"unsupported-platform": "not-implemented",
	"handler-error": "handler-error",
	// A command that ran and failed on the server is never a caller mistake: these codes must not
	// answer 400, or a caller that branches on the transport reads a failed integrity check as a
	// malformed request.
	"signature-mismatch": "handler-error",
	"hash-mismatch": "handler-error",
	"unverified-artifact": "handler-error",
	"relaunch-failed": "handler-error",
	"io-error": "handler-error",
	corrupt: "handler-error",
	"sql-error": "handler-error",
	"contract-violation": "handler-error",
};

/**
 * The HTTP status for a command result. `200` for every success and for anything that is not the
 * typed failure shape; a mapped 4xx/5xx for a failure, with an unmapped code defaulting to 400.
 */
export function resultStatus(result: unknown): number {
	if (result === null || typeof result !== "object") return 200;
	const answer = result as { ok?: unknown; code?: unknown };
	if (answer.ok !== false || typeof answer.code !== "string") return 200;
	// `Object.hasOwn`, not a bare index: `code` is untrusted, and an inherited name such as
	// `__proto__`, `constructor` or `toString` would otherwise skip the 400 default and hand
	// `jsonResponse` an `undefined` status — which it turns into a 200 success.
	const condition = Object.hasOwn(CONDITION, answer.code) ? CONDITION[answer.code] : undefined;
	return condition === undefined ? 400 : statusForCode(condition);
}
