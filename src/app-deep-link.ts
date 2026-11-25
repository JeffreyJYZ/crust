/**
 * Runtime half of `crust:deep-link`, split out of `app-loop.ts` at the 200-line cap. The plugin owns
 * state and emits; this module supplies the two things only a runtime can know — the scheme the
 * bundle registered, and a page-delivery sink — and holds a link that arrives before any page
 * armed one, so a click during startup is replayed rather than dropped.
 */

import type { CrustConfig } from "@/config";
import { deepLink as defaultLink, type DeepLink } from "@/plugins";
import { parseDeepLink } from "@/plugins/deep-link.ts";
import type { PluginContext } from "./plugins/define.ts";

/** Page sinks armed by a live `ctx.emit`; a Set because one page may invoke several commands. */
const pages = new Set<PluginContext["emit"]>();
/** Links recorded while no page was armed, replayed in arrival order when the first one is. */
const early: string[] = [];
const attached = new WeakSet<DeepLink>();

/** The one sink handed to `deepLink.attach`: every link fans out to whichever pages are armed. */
const deliver: PluginContext["emit"] = (event, data) => {
	for (const emit of pages) emit(event, data);
};

/** Supply the bundle's registered scheme; with no `build.urlScheme` the guard stays off by name. */
export function configureDeepLink(config: CrustConfig, link: DeepLink = defaultLink): void {
	link.configure(config.build?.urlScheme);
}

/** Register the app-wide sink once, so a later `deepLink.open` reaches every armed page. */
export function attachDeepLinkDelivery(link: DeepLink = defaultLink): () => void {
	if (attached.has(link)) return () => {};
	attached.add(link);
	return link.attach(deliver);
}

/**
 * Record a link the OS delivered. With no page armed yet it is held (and `url()` filled for a page
 * that polls); with one armed, `open` emits through the attached sink to that page.
 */
export function queueDeepLink(url: string, link: DeepLink = defaultLink): void {
	// The native argv scanner accepts any RFC-3986 scheme, while `accept()` throws for a relative
	// URL or a foreign scheme. Without this guard a direct launch with a stray URL rejected
	// `app.run()` after the windows were created, and a later bad URL escaped the drain timer as an
	// uncaught exception. Refuse here, where the URL can be named, and keep the app alive.
	try {
		const target = parseDeepLink(url);
		const scheme = link.scheme;
		if (scheme !== undefined && target.scheme !== scheme) {
			console.warn(
				`  deep-link refused ${JSON.stringify(url)}: not the registered scheme "${scheme}"`,
			);
			return;
		}
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		console.warn(`  deep-link refused ${JSON.stringify(url)}: ${text}`);
		return;
	}
	if (pages.size === 0) {
		// Launch first, so a URL the scheme guard refuses never enters the replay queue.
		link.launch(url);
		early.push(url);
	} else {
		link.open(url);
	}
}

/**
 * Arm delivery for a page that just invoked a command — the only place a page-side `ctx.emit`
 * exists outside the bridge. Links held from before the page existed are replayed to it.
 */
export function armDeepLinkPage(emit: PluginContext["emit"]): () => void {
	pages.add(emit);
	for (const url of early.splice(0)) emit("deep-link", { url });
	return () => {
		pages.delete(emit);
	};
}
