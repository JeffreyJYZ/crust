/**
 * Structured bridge errors.
 *
 * Every failure the bridge produces carries a machine-readable `code`, so page
 * code branches on `error.code` instead of string-matching a status. The code
 * set is the one the probe measured: research/bridge.md §"Implementer surprises"
 * item 7.
 */

export type CrustErrorCode =
	| "unauthorized"
	| "bad-origin"
	| "not-found"
	| "unknown-plugin"
	| "unknown-command"
	| "bad-json"
	| "bad-request"
	| "handler-error"
	| "too-large"
	| "not-implemented";

const STATUS: Record<CrustErrorCode, number> = {
	unauthorized: 401,
	"bad-origin": 403,
	"not-found": 404,
	"unknown-plugin": 404,
	"unknown-command": 404,
	"bad-json": 400,
	"bad-request": 400,
	"handler-error": 500,
	"too-large": 413,
	"not-implemented": 501,
};

export type SerializedCrustError = {
	code: CrustErrorCode;
	message: string;
	requires?: string;
};

export interface CrustErrorOptions {
	status?: number;
	/** What the platform is missing, for a `not-implemented` failure. */
	requires?: string;
}

export class CrustError extends Error {
	readonly code: CrustErrorCode;
	readonly status: number;
	readonly requires?: string;

	constructor(code: CrustErrorCode, message: string, options: CrustErrorOptions = {}) {
		super(message);
		this.name = "CrustError";
		this.code = code;
		this.status = options.status ?? STATUS[code];
		if (options.requires !== undefined) this.requires = options.requires;
	}

	toJSON(): SerializedCrustError {
		const body: SerializedCrustError = { code: this.code, message: this.message };
		if (this.requires !== undefined) body.requires = this.requires;
		return body;
	}
}

export function statusForCode(code: CrustErrorCode): number {
	return STATUS[code];
}

export function isCrustError(value: unknown): value is CrustError {
	return value instanceof CrustError;
}

/** Reduce anything thrown by a handler to a `CrustError` without losing its message. */
export function toCrustError(value: unknown): CrustError {
	if (value instanceof CrustError) return value;
	const message = value instanceof Error ? value.message : String(value);
	return new CrustError("handler-error", message);
}
