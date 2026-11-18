/**
 * `crust:updater`'s URL policy: `download` and `check` fetch `https` only, and `file` only when the
 * app's config opted in with `updater.allowFileUrl`. A page-supplied url with no scheme restriction is
 * a way to read any path on disk or to reach a loopback port, so the scheme is refused by name
 * rather than left to the adapter.
 */

import { invalidArguments, type UpdaterFailure } from "./updater-args";

/** What the app allows; only `updater.allowFileUrl` in the config can turn `file:` on. */
export interface FetchUrlPolicy {
	readonly allowFile: boolean;
}

const HTTPS = "https:";
const FILE = "file:";

/**
 * `undefined` when the url may be fetched, otherwise the refusal naming the scheme and the rule.
 * `command` is the calling updater command (`download` or `check`) so the refusal names it.
 */
export function fetchUrlFailure(
	url: string,
	policy: FetchUrlPolicy,
	command = "download",
): UpdaterFailure | undefined {
	let scheme: string;
	try {
		scheme = new URL(url).protocol;
	} catch {
		return invalidArguments(command, "needs an absolute url", { url });
	}
	if (scheme === HTTPS) return undefined;
	if (scheme === FILE && policy.allowFile) return undefined;
	if (scheme === FILE) {
		const refusal = invalidArguments(
			command,
			"refuses a file url: only https is fetched unless updater.allowFileUrl is true",
			{ url },
		);
		return { ...refusal, requires: "updater.allowFileUrl" };
	}
	return invalidArguments(command, `refuses a ${scheme} url: only https is fetched`, { url });
}
