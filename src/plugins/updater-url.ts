/**
 * `crust:updater`'s URL policy: `download` fetches `https` only, and `file` only when the app's
 * config opted in with `updater.allowFileUrl`. A page-supplied `url` with no scheme restriction is
 * a way to read any path on disk or to reach a loopback port, so the scheme is refused by name
 * rather than left to the adapter.
 */

import { invalidArguments, type UpdaterFailure } from "./updater-args";

/** What the app allows; only `updater.allowFileUrl` in the config can turn `file:` on. */
export interface DownloadUrlPolicy {
	readonly allowFile: boolean;
}

const HTTPS = "https:";
const FILE = "file:";

/** `undefined` when the URL may be fetched, otherwise the refusal naming the scheme and the rule. */
export function downloadUrlFailure(
	url: string,
	policy: DownloadUrlPolicy,
): UpdaterFailure | undefined {
	let scheme: string;
	try {
		scheme = new URL(url).protocol;
	} catch {
		return invalidArguments("download", "needs an absolute url", { url });
	}
	if (scheme === HTTPS) return undefined;
	if (scheme === FILE && policy.allowFile) return undefined;
	if (scheme === FILE) {
		const refusal = invalidArguments(
			"download",
			"refuses a file url: only https is fetched unless updater.allowFileUrl is true",
			{ url },
		);
		return { ...refusal, requires: "updater.allowFileUrl" };
	}
	return invalidArguments("download", `refuses a ${scheme} url: only https is fetched`, { url });
}
