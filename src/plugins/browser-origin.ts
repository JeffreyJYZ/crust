/**
 * The two gates every load passes before it reaches any native call: `http(s)` only, and only an
 * origin the app named in `browser.origins`.
 *
 * An origin is scheme, host and port — never a path. Comparing `url.origin` is what keeps
 * `https://example.com.evil.test` and `https://example.com:8443` out of a list that named
 * `https://example.com`; a prefix check answers both wrongly. Config validation refuses a path in
 * an entry, and this module re-normalises anyway because a config can arrive from an extension.
 */
import type { BrowserConfig } from "@/config";
import type { BrowserFailure } from "./browser-types";

/** The scheme+host+port form of an `http(s)` URL, or undefined for anything else. */
export function originOf(value: string): string | undefined {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return undefined;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
	if (url.hostname.length === 0) return undefined;
	return url.origin;
}

/** The allow list, normalised once at construction so every later check is a string compare. */
export interface OriginPolicy {
	readonly origins: readonly string[];
	/** Refuse a URL before a native call; `command` names the command in the message. */
	refusal(url: string, command: string): BrowserFailure | undefined;
}

export function originPolicy(config?: BrowserConfig): OriginPolicy {
	const origins = (config?.origins ?? [])
		.map((entry) => originOf(entry))
		.filter((entry): entry is string => entry !== undefined);
	const allowed = origins.length === 0 ? "none" : origins.join(", ");

	return {
		origins,
		refusal(url, command) {
			const origin = originOf(url);
			if (origin === undefined) {
				return {
					ok: false,
					code: "bad-request",
					message:
						`browser.${command}: ${JSON.stringify(url)} is not an http(s) URL; ` +
						"the embedded surface loads http and https only",
				};
			}
			if (!origins.includes(origin)) {
				return {
					ok: false,
					code: "bad-request",
					message:
						`browser.${command}: origin ${origin} is not in browser.origins ` +
						`(allowed: ${allowed})`,
				};
			}
			return undefined;
		},
	};
}
