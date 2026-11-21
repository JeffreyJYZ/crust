/**
 * The two refusal shapes every platform's browser adapter answers. Kept in the plugin rather than in
 * one platform's directory because all three implementations produce them, and a second copy is a
 * second message a page has to read.
 */
import { CrustError } from "@/bridge/errors";
import type { BrowserFailure } from "./browser-types";

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
