/**
 * `crust:deep-link` — the URL the app was opened with, and every later one macOS delivers. This module owns no framework: AppKit hands a URL to the app delegate, and the runtime calls {@link DeepLink.open} with it, so the same state works on a platform with no URL routing at all.
 * Two things are deliberately separate: `url()` is what the app is holding now, and `emit` is how a page hears about a change. A second open replaces the first — a page that only reads `url()` at startup would otherwise show the launch URL forever.
 */

import { validateScheme } from "../packaging/deep-link.ts";
import {
	definePlugin,
	notImplemented,
	type NotImplemented,
	type PluginContext,
	type PluginDefinition,
} from "./define.ts";

/** A parsed URL. `scheme` is lowercased without its colon; `host` is empty for an opaque form like `crust:open`. */
export interface DeepLinkTarget {
	scheme: string;
	host: string;
	path: string;
	/** Last value wins for a repeated key, which is what `URLSearchParams.get` answers. */
	query: Record<string, string>;
}

export interface DeepLinkOptions {
	/** The scheme this bundle registers in `Info.plist`. Absent means nothing was wired, and `scheme()` says so. */
	scheme?: string;
}

export type DeepLinkPlugin = PluginDefinition<
	"deep-link",
	{
		scheme: () => string | NotImplemented;
		url: () => string | null;
	}
>;

export interface DeepLink {
	readonly plugin: DeepLinkPlugin;
	/** The registered scheme, or `undefined` when the build registered none. */
	readonly scheme: string | undefined;
	/** The URL held now: the launch URL until a later open replaces it, else `null`. */
	url(): string | null;
	/** Record the URL the app was launched with. An absent or empty one is no link, and emits nothing. */
	launch(url: string | undefined, ctx?: PluginContext): DeepLinkTarget | null;
	/** Record a URL the OS opened later, replacing the launch one, and push it to every page. */
	open(url: string, ctx?: PluginContext): DeepLinkTarget;
}

/**
 * Parse an absolute URL into its parts. `new URL` is the parser because the platform's own router uses it; a relative string is refused here, since a launch argument that is not absolute cannot be a deep link.
 */
export function parseDeepLink(url: unknown): DeepLinkTarget {
	if (typeof url !== "string" || url.length === 0) {
		throw new TypeError("crust: deep-link url must be a non-empty string");
	}
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new TypeError(`crust: deep-link url ${JSON.stringify(url)} is not an absolute URL`);
	}
	const query: Record<string, string> = {};
	for (const [key, value] of parsed.searchParams) query[key] = value;
	return {
		scheme: parsed.protocol.replace(/:$/, "").toLowerCase(),
		host: parsed.hostname,
		path: parsed.pathname,
		query,
	};
}

export function createDeepLink(options: DeepLinkOptions = {}): DeepLink {
	const scheme = options.scheme === undefined ? undefined : validateScheme(options.scheme);
	let current: string | null = null;

	const accept = (url: string, ctx?: PluginContext): DeepLinkTarget => {
		const target = parseDeepLink(url);
		if (scheme !== undefined && target.scheme !== scheme) {
			throw new TypeError(
				`crust: deep-link url ${JSON.stringify(url)} is not the registered scheme "${scheme}"`,
			);
		}
		// Store before emitting, so a listener that reads `url()` inside the event sees the new value.
		current = url;
		ctx?.emit("deep-link", { url });
		return target;
	};

	const plugin = definePlugin({
		name: "deep-link",
		commands: {
			scheme: (): string | NotImplemented =>
				scheme ??
				notImplemented(
					"deep-link.scheme needs a registered scheme: pass { scheme } to createDeepLink and merge CFBundleURLTypes into Info.plist, or macOS never routes a URL to this app.",
					"CFBundleURLTypes",
				),
			url: (): string | null => current,
		},
	});

	return {
		plugin,
		scheme,
		url: () => current,
		launch: (url, ctx) => (url === undefined || url.length === 0 ? null : accept(url, ctx)),
		open: accept,
	};
}

/** The default registration: no scheme and no URL until the runtime supplies both. */
export const deepLink = createDeepLink();
