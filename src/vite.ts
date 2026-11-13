/**
 * `crust/vite` — the dev-server half of the bridge.
 *
 * With `dev.url` set, the window loads a document the dev server serves, not
 * the bridge's own. The bootstrap the bridge injects therefore never reaches
 * that page, and `invoke("name", args)` — the two-argument app form — has no
 * `window.crust` to rewrite the call. This plugin puts the same client in the
 * dev server's document: `transformIndexHtml` adds `window.__CRUST__` and the
 * page-side client, which installs itself from that global.
 *
 * The values come from the bridge, never from the plugin: on the first `run()`
 * the runtime writes them to `.crust/dev.json` (or `CRUST_DEV_FILE`), and the
 * plugin reads that file per document — `CRUST_BRIDGE_URL` and
 * `CRUST_BRIDGE_TOKEN` are the explicit override on top. Absent, it prints one
 * warning and injects nothing: a page without `window.crust` fails loudly on
 * its first call, and a guessed address would fail quietly against a bridge
 * that is not there.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { pageClientSource } from "./bridge/client.ts";

/** The variable `crust dev` sets to the bridge's absolute URL. */
export const BRIDGE_URL_VAR = "CRUST_BRIDGE_URL";
/** The variable `crust dev` sets to the per-launch token. */
export const BRIDGE_TOKEN_VAR = "CRUST_BRIDGE_TOKEN";

export interface CrustOptions {
	/** Environment variable holding the bridge URL. */
	urlVar?: string;
	/** Environment variable holding the per-launch token. */
	tokenVar?: string;
}

/**
 * Inject the bridge address and the page client into the served document.
 *
 * Serve-only: a build has no bridge, and shipping a token in built HTML is
 * exactly what `dev.url` must not do.
 */
export function crust(options: CrustOptions = {}): Plugin {
	const urlVar = options.urlVar ?? BRIDGE_URL_VAR;
	const tokenVar = options.tokenVar ?? BRIDGE_TOKEN_VAR;
	let warned = false;

	// Read per document, not once at config time: the dev server is started
	// before the runtime's bridge exists, so the only honest moment to look is
	// when a page is actually served.
	const read = () => {
		const env = {
			url: (process.env[urlVar] ?? "").trim(),
			token: (process.env[tokenVar] ?? "").trim(),
		};
		if (env.url.length > 0 && env.token.length > 0) return env;
		// The dev server is spawned before the runtime's bridge binds, so the port
		// and token arrive through a file the runtime writes on first `run()`.
		try {
			const file = process.env.CRUST_DEV_FILE ?? join(process.cwd(), ".crust", "dev.json");
			const parsed = JSON.parse(readFileSync(file, "utf8")) as {
				url?: string;
				token?: string;
			};
			return { url: (parsed.url ?? "").trim(), token: (parsed.token ?? "").trim() };
		} catch {
			return env;
		}
	};

	return {
		name: "crust",
		apply: "serve",
		transformIndexHtml: {
			order: "pre",
			handler(html) {
				const { url, token } = read();
				if (url.length === 0 || token.length === 0) {
					if (!warned) {
						warned = true;
						console.warn(
							`[crust] ${urlVar}/${tokenVar} are unset, so this page gets no window.crust. ` +
								"Start the dev server through `crust dev`, which exports both for it.",
						);
					}
					return html;
				}
				return {
					html,
					tags: [
						{
							tag: "script",
							children: `window.__CRUST__ = ${JSON.stringify({ url, token })};`,
							injectTo: "head-prepend" as const,
						},
						{
							tag: "script",
							children: pageClientSource(),
							injectTo: "head-prepend" as const,
						},
					],
				};
			},
		},
	};
}
