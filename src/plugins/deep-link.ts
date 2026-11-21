/**
 * `crust:deep-link` — the URL the app was opened with, and every later one the runtime feeds in. This module owns no framework: AppKit hands a URL to the app delegate, and the runtime calls {@link DeepLink.open} with it, so the same state works on a platform with no URL routing at all.
 * Two things are deliberately separate: `url()` is what the app is holding now, and `emit` is how a page hears about a change. A second open replaces the first — a page that only reads `url()` at startup would otherwise show the launch URL forever.
 * A link only reaches pages when the caller supplies an emit context or registers one with
 * {@link DeepLink.attach}; `open(url)` with neither records the URL and emits nothing. This module
 * cannot read `Info.plist` or the platform's open-URL delegate, so the runtime owns supplying both
 * the registered scheme ({@link DeepLink.configure}) and a delivery sink. Until it does, `scheme()`
 * answers not-implemented rather than pretending a scheme was registered.
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
	/** The registered scheme, or `undefined` when the runtime supplied none. */
	readonly scheme: string | undefined;
	/**
	 * Supply the scheme the bundle registers (from `build.urlScheme`). The singleton is created
	 * before config is read, so this is the one place a runtime can wire it without building a
	 * second instance and leaving `scheme()` permanently not-implemented.
	 */
	configure(scheme: string | undefined): void;
	/**
	 * Register an app-wide emit sink for later links. Returns the function that removes it. A
	 * `ctx` passed to `launch`/`open` is used for that call; attached sinks hear every link.
	 */
	attach(emit: PluginContext["emit"]): () => void;
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
	let scheme = options.scheme === undefined ? undefined : validateScheme(options.scheme);
	let current: string | null = null;
	const sinks = new Set<PluginContext["emit"]>();

	const accept = (url: string, ctx?: PluginContext): DeepLinkTarget => {
		const target = parseDeepLink(url);
		if (scheme !== undefined && target.scheme !== scheme) {
			throw new TypeError(
				`crust: deep-link url ${JSON.stringify(url)} is not the registered scheme "${scheme}"`,
			);
		}
		// Store before emitting, so a listener that reads `url()` inside the event sees the new value.
		current = url;
		const listeners = new Set<PluginContext["emit"]>(sinks);
		if (ctx) listeners.add(ctx.emit);
		for (const emit of listeners) emit("deep-link", { url });
		return target;
	};

	const plugin = definePlugin({
		name: "deep-link",
		commands: {
			scheme: (): string | NotImplemented =>
				scheme ??
				notImplemented(
					"deep-link.scheme has no registered scheme: the runtime must call " +
						"deepLink.configure(config.build?.urlScheme) and merge CFBundleURLTypes into " +
						"Info.plist, or macOS never routes a URL to this app.",
					"CFBundleURLTypes",
				),
			url: (): string | null => current,
		},
	});

	return {
		plugin,
		get scheme() {
			return scheme;
		},
		configure: (next) => {
			scheme = next === undefined ? undefined : validateScheme(next);
		},
		attach: (emit) => {
			sinks.add(emit);
			return () => sinks.delete(emit);
		},
		url: () => current,
		launch: (url, ctx) => (url === undefined || url.length === 0 ? null : accept(url, ctx)),
		open: accept,
	};
}

/** The default registration: no scheme and no URL until the runtime supplies both. */
export const deepLink = createDeepLink();
