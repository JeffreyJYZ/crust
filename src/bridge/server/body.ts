/**
 * The body reader, split out of `invoke.ts` when the invoke log pushed that file past the line cap.
 *
 * `content-length` is only a client claim: a chunked POST omits it, so the cap has to be applied
 * while streaming or the whole body is buffered first. Counting raw bytes also catches the
 * multibyte case a UTF-16 `text.length` check misses.
 */

import { CrustError } from "../errors";

/** Bodies over this size are refused before parsing, as the probe measured. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

export async function readCappedBody(request: Request): Promise<Uint8Array> {
	const body = request.body;
	if (!body) return new Uint8Array(0);
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_BODY_BYTES) {
				await reader.cancel();
				throw new CrustError("too-large", "payload too large");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

/** The wire size of a result or an argument, for `bytesIn`/`bytesOut`. Never throws. */
export function byteLengthOf(value: unknown): number {
	if (value === undefined || value === null) return 0;
	if (value instanceof Uint8Array) return value.byteLength;
	if (typeof value === "string") return Buffer.byteLength(value);
	try {
		const text = JSON.stringify(value);
		return typeof text === "string" ? Buffer.byteLength(text) : 0;
	} catch {
		return 0;
	}
}
