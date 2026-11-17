/**
 * The two bounds `download` needs on a response: a byte cap, so a wrong or hostile URL answering
 * with an endless body cannot fill the temp dir before the digest is computed, and a redirect
 * refusal, so "only https" covers the bytes actually fetched and not just the URL handed in. A
 * `https:` URL answering 302 to `http://` would otherwise arrive in cleartext.
 */

import { UpdaterAdapterError } from "./updater-args";

/** How many bytes one artifact may be. A bundle is tens of MB; half a gigabyte is generous. */
export const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;

/** Read the body in chunks, refusing by name the moment it passes `limit`. */
export async function readBounded(
	response: Response,
	url: string,
	limit: number = MAX_DOWNLOAD_BYTES,
): Promise<Uint8Array> {
	const declared = Number(response.headers.get("content-length") ?? "0");
	if (Number.isFinite(declared) && declared > limit) {
		throw new UpdaterAdapterError(
			"download-failed",
			`updater: ${url} answers ${declared} bytes, over the ${limit} byte cap`,
		);
	}
	if (response.body === null) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for await (const chunk of response.body) {
		total += chunk.byteLength;
		if (total > limit) {
			throw new UpdaterAdapterError(
				"download-failed",
				`updater: ${url} is over the ${limit} byte cap`,
			);
		}
		chunks.push(chunk);
	}
	return new Uint8Array(Buffer.concat(chunks));
}

/**
 * A 3xx is a refusal. `redirect: "manual"` hands it back instead of following it, so the scheme
 * policy in `updater-url` decides once, on the URL the caller passed, and no second hop is taken.
 */
export function redirectFailure(url: string, response: Response): UpdaterAdapterError | undefined {
	if (response.type !== "opaqueredirect" && !(response.status >= 300 && response.status < 400)) {
		return undefined;
	}
	const location = response.headers.get("location");
	const where = location === null ? "a redirect" : `a redirect to ${location}`;
	return new UpdaterAdapterError(
		"download-failed",
		`updater: ${url} answered ${where}, and download follows no redirect`,
	);
}
