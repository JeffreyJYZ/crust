/**
 * The two bounds `fetchJson` and `download` need on a response: a byte cap, so a wrong or hostile URL
 * answering with an endless body cannot fill the temp dir before the digest is computed, and a
 * redirect policy, so "only https" covers the bytes actually fetched and not just the URL handed in.
 *
 * Following a hop looks like loosening pinning; it is not. The security boundary is the pinned
 * Ed25519 `updater.pubkey` over the artifact bytes, not the host those bytes arrive from. That is
 * what makes `https://github.com/<owner>/<repo>/releases/latest/download/<asset>` usable at all: it
 * answers 302 on every request, so refusing every 3xx refused the most obvious place to host a feed.
 * What stays refused is a hop that leaves https — a plaintext body is not the artifact anyone signed.
 */

import { UpdaterAdapterError } from "./updater-args";

/** How many bytes one artifact may be. A bundle is tens of MB; half a gigabyte is generous. */
export const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;

/** A manifest is one small JSON object, so its read is bounded far tighter than an artifact. */
export const MANIFEST_BYTES = 256 * 1024;

/** Hops a feed may chain through. GitHub Releases uses one; a redirect loop must not run free. */
export const MAX_REDIRECT_HOPS = 5;

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

function isRedirect(response: Response): boolean {
	return response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400);
}

/** Read a feed through the same cap as an artifact, then parse: no unbounded `response.json()`. */
export async function readJsonBounded(response: Response, url: string): Promise<unknown> {
	const bytes = await readBounded(response, url, MANIFEST_BYTES);
	return JSON.parse(new TextDecoder().decode(bytes));
}

/** One request as this module makes it; injected by a test, never by the plugin. */
export type RedirectFetch = (url: string) => Promise<Response>;

/**
 * Fetch `url`, following at most {@link MAX_REDIRECT_HOPS} `https` redirects. `redirect: "manual"`
 * hands every 3xx back instead of letting `fetch` follow it silently, so each hop is checked here:
 * a `location` that is not `https:` refuses before a request for it is made.
 */
export async function fetchFollowing(
	url: string,
	init: RequestInit = {},
	fetchImpl?: RedirectFetch,
): Promise<Response> {
	const send: RedirectFetch =
		fetchImpl ?? ((target) => fetch(target, { ...init, redirect: "manual" }));
	let current = url;
	for (let followed = 0; ; followed++) {
		const response = await send(current);
		if (!isRedirect(response)) return response;
		const location = response.headers.get("location");
		if (location === null) {
			throw new UpdaterAdapterError(
				"download-failed",
				`updater: ${current} answered a redirect with no location`,
			);
		}
		let next: URL;
		try {
			next = new URL(location, current);
		} catch {
			throw new UpdaterAdapterError(
				"download-failed",
				`updater: ${current} redirects to ${location}, which is not a url`,
			);
		}
		if (next.protocol !== "https:") {
			throw new UpdaterAdapterError(
				"download-failed",
				`updater: ${current} redirects to ${next.href}, refusing a ${next.protocol} hop: only https is followed`,
			);
		}
		if (followed >= MAX_REDIRECT_HOPS) {
			throw new UpdaterAdapterError(
				"download-failed",
				`updater: ${url} answered more than ${MAX_REDIRECT_HOPS} redirects, so the chain is refused`,
			);
		}
		current = next.href;
	}
}
