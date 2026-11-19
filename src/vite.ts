/**
 * `crust/vite` — the dev-server half of the bridge. With `dev.url` set the window loads a document the dev server serves, so the bridge's bootstrap never reaches it and `invoke("name", args)` has no `window.crust`; `transformIndexHtml` adds `window.__CRUST__` and the page-side client instead.
 * Values come from the bridge, never the plugin: the runtime writes `.crust/dev.json` (or `CRUST_DEV_FILE`) and the plugin reads it per document, with `CRUST_BRIDGE_URL`/`CRUST_BRIDGE_TOKEN` as explicit overrides. Absent, it warns and injects nothing — a guessed address fails quietly against a bridge that is not there.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { pageClientSource } from "./bridge/client.ts";
import { DEFAULT_WINDOW_LABEL, TOKEN_PARAM, WINDOW_PARAM } from "./bridge/window-identity.ts";

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
 * Ask the bridge for a document token bound to the default label and hand that to the page.
 *
 * The process token may seed a document for *any* label, so injecting it would let a page mint
 * another window's grants with one navigation. A minted document token re-serves only its own
 * document: it is a real credential for invoke, but never a seeding one.
 */
async function mintPageToken(bridgeUrl: string, seed: string): Promise<string | undefined> {
	try {
		const document = new URL("/", bridgeUrl);
		document.searchParams.set(TOKEN_PARAM, seed);
		document.searchParams.set(WINDOW_PARAM, DEFAULT_WINDOW_LABEL);
		const response = await fetch(document, { redirect: "manual" });
		if (response.status !== 302) return undefined;
		const location = response.headers.get("location");
		if (location === null) return undefined;
		const token = new URL(location, document).searchParams.get(TOKEN_PARAM);
		return token === null || token.length === 0 ? undefined : token;
	} catch {
		return undefined;
	}
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
			async handler(html) {
				const { url, token } = read();
				const warn = (reason: string) => {
					if (!warned) {
						warned = true;
						console.warn(`[crust] ${reason} This page gets no window.crust.`);
					}
					return html;
				};
				if (url.length === 0 || token.length === 0) {
					return warn(
						`${urlVar}/${tokenVar} are unset. Start the dev server through ` +
							"`crust dev`, which exports both for it.",
					);
				}
				const pageToken = await mintPageToken(url, token);
				if (pageToken === undefined) {
					return warn(`the bridge at ${url} did not mint a page token.`);
				}
				return {
					html,
					tags: [
						{
							tag: "script",
							children: `window.__CRUST__ = ${JSON.stringify({ url, token: pageToken })};`,
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
