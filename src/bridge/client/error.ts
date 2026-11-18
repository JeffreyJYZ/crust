/**
 * The page-facing error guard. `instanceof` cannot cross the bridge: the injected client builds its
 * error in the page realm, so the portable check is structural — the name that client stamps plus
 * the fields its wire contract guarantees.
 */

import type { CrustInvokeError } from "./types.ts";

export type { CrustInvokeError } from "./types.ts";

export function isCrustInvokeError(value: unknown): value is CrustInvokeError {
	if (typeof value !== "object" || value === null) return false;
	const error = value as { name?: unknown; code?: unknown; status?: unknown; requires?: unknown };
	return (
		error.name === "CrustInvokeError" &&
		typeof error.code === "string" &&
		typeof error.status === "number" &&
		(error.requires === undefined || typeof error.requires === "string")
	);
}
