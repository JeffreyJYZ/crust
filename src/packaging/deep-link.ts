/**
 * Deep linking, packaging half: the `CFBundleURLTypes` entry that makes macOS hand a custom-scheme URL to the bundle, and the scheme validation that keeps a typo out of `Info.plist`. A scheme macOS never routes produces no error at all — the app launches and simply never hears the URL — so the refusal belongs at build time.
 * `mergeDeepLinkPlist` is the whole merge: the plist body stays in `plist.ts`, and this only inserts one top-level key before its closing dict.
 */

import { CrustError } from "../bridge/errors";

/** Schemes macOS or a browser already owns; registering one hijacks every link that uses it. */
export const RESERVED_SCHEMES = ["http", "https", "file"] as const;

/** RFC 3986 scheme: a letter, then letters, digits, `+`, `.` or `-`. Lowercase only, so the plist cannot disagree with the URL's own case-folded protocol. */
const SCHEME = /^[a-z][a-z0-9+.-]*$/;

/** One `CFBundleURLTypes` row: a display name and the single scheme it answers. */
export interface DeepLinkPlistEntry {
	CFBundleURLName: string;
	CFBundleURLSchemes: string[];
}

function escapeXml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The scheme as it goes into the bundle, or a `bad-request` naming why not. Reserved is checked case-insensitively: `HTTP` fails the pattern anyway, but the message should say "reserved" rather than "malformed".
 */
export function validateScheme(scheme: unknown): string {
	if (typeof scheme !== "string" || scheme.length === 0) {
		throw new CrustError("bad-request", "crust: deep-link scheme must be a non-empty string");
	}
	if ((RESERVED_SCHEMES as readonly string[]).includes(scheme.toLowerCase())) {
		throw new CrustError(
			"bad-request",
			`crust: deep-link scheme "${scheme}" is reserved by the system; pick an app-owned scheme such as "crust"`,
		);
	}
	if (!SCHEME.test(scheme)) {
		throw new CrustError(
			"bad-request",
			`crust: deep-link scheme "${scheme}" must match [a-z][a-z0-9+.-]*`,
		);
	}
	return scheme;
}

/**
 * The plist row for a scheme. `CFBundleURLName` defaults to the scheme, which macOS accepts; pass the bundle identifier when two apps could register the same scheme, because that name is what LaunchServices keys on.
 */
export function deepLinkPlistEntry(
	scheme: unknown,
	options: { name?: string } = {},
): DeepLinkPlistEntry {
	const valid = validateScheme(scheme);
	return {
		CFBundleURLName: options.name ?? valid,
		CFBundleURLSchemes: [valid],
	};
}

/** The entry as XML, indented to sit directly under the plist's top-level dict. */
export function deepLinkPlistFragment(entry: DeepLinkPlistEntry): string {
	const rows = entry.CFBundleURLSchemes.map(
		(scheme) => `\t\t\t\t<string>${escapeXml(scheme)}</string>\n`,
	).join("");
	return `\t<key>CFBundleURLTypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>CFBundleURLName</key>
\t\t\t<string>${escapeXml(entry.CFBundleURLName)}</string>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array>
${rows}\t\t\t</array>
\t\t</dict>
\t</array>
`;
}

/** Insert the fragment before the plist's closing dict. Refuses a body it cannot place, rather than appending XML after `</plist>`. */
export function mergeDeepLinkPlist(plist: string, entry: DeepLinkPlistEntry): string {
	const marker = "</dict>\n</plist>";
	const at = plist.lastIndexOf(marker);
	if (at < 0) {
		throw new Error("crust: Info.plist has no closing </dict> before </plist> to merge into");
	}
	return `${plist.slice(0, at)}${deepLinkPlistFragment(entry)}${plist.slice(at)}`;
}
