/** The two refusal shapes the darwin adapter answers. Kept apart so the adapter reads as its calls. */
import { CrustError } from "@/bridge/errors";
import type { BrowserFailure } from "@/plugins/browser";

/** An adapter throw as a value; a resolver's `bad-request` stays the code the caller can fix. */
export function asFailure(error: unknown): BrowserFailure {
	if (error instanceof CrustError && error.code === "bad-request") {
		return { ok: false, code: "bad-request", message: error.message };
	}
	return {
		ok: false,
		code: "handler-error",
		message: error instanceof Error ? error.message : String(error),
	};
}

/** An unknown surface is `not-found`, not a silent no-op. */
export function absent(label: string): BrowserFailure {
	return {
		ok: false,
		code: "not-found",
		message: `browser: no surface called ${JSON.stringify(label)} is open`,
	};
}
