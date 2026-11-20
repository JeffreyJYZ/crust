/**
 * `POST /_crust/log`: the page world's console and uncaught errors, relayed by the content-world
 * script that holds the bearer token. It is the one write route a page has without a capability
 * grant, so it accepts only a bounded JSON payload and only the record shapes `pageRecord` knows.
 *
 * The page never chooses a level above the truth: a `console.log` is `info`, `console.error` and an
 * uncaught error are `error`. `window` comes from the token's bound label, never from the body.
 */

import { CrustError } from "../errors";
import { logEvent } from "@/logging/logger";
import { type PageLogPayload, pageRecord } from "@/logging/records";
import { MAX_BODY_BYTES, readCappedBody } from "./body.ts";
import { errorResponse } from "./http.ts";

export const PAGE_LOG_PATH = "/_crust/log";

const KINDS = new Set(["console", "error", "rejection"]);

/** Validate the untrusted payload, or answer why it is not a page record. */
export function toPageLogPayload(value: unknown): PageLogPayload {
	if (typeof value !== "object" || value === null) {
		throw new CrustError("bad-request", "page log payload must be an object");
	}
	const body = value as Record<string, unknown>;
	if (typeof body.kind !== "string" || !KINDS.has(body.kind)) {
		throw new CrustError("bad-request", "page log kind must be console, error or rejection");
	}
	const payload: PageLogPayload = { kind: body.kind as PageLogPayload["kind"] };
	if (typeof body.level === "string") payload.level = body.level;
	if (Array.isArray(body.args)) payload.args = body.args.slice(0, 50);
	if (typeof body.message === "string") payload.message = body.message.slice(0, 4000);
	if (typeof body.stack === "string") payload.stack = body.stack.slice(0, 8000);
	if (typeof body.url === "string") payload.url = body.url.slice(0, 2000);
	if (typeof body.line === "number") payload.line = body.line;
	if (typeof body.col === "number") payload.col = body.col;
	return payload;
}

export async function pageLogRequest(
	request: Request,
	cors?: Record<string, string>,
	window?: string,
): Promise<Response> {
	try {
		if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) {
			throw new CrustError("too-large", "payload too large");
		}
		const text = new TextDecoder().decode(await readCappedBody(request));
		let body: unknown;
		try {
			body = JSON.parse(text);
		} catch {
			throw new CrustError("bad-json", "page log body is not json");
		}
		logEvent(pageRecord(toPageLogPayload(body), window));
		return new Response(null, { status: 204, headers: cors ?? {} });
	} catch (error) {
		return errorResponse(error, cors);
	}
}
