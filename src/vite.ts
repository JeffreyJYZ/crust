/**
 * `crust/vite` — the dev-server half of the bridge. With `dev.url` set the window loads a document the dev server serves, so the bridge's bootstrap never reaches it and `invoke("name", args)` has no `window.crust`; `transformIndexHtml` adds `window.__CRUST__` and the page-side client instead.
 * Values come from the runtime, never from a round trip here: the runtime mints one document token per window label where the bridge is bound and writes them to `devHandshakePath()` in the OS temp dir — never into the project root a dev server serves. The plugin finds that path through `CRUST_DEV_FILE` or the same project hash, with `CRUST_BRIDGE_URL`/`CRUST_BRIDGE_TOKEN` as explicit single-token overrides. It only reads and injects — a fetch inside HTML transformation raced the bridge bind and could silently leave the page with no client.
 */
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";
import { pageClientSource } from "./bridge/client.ts";
import { devHandshakePath, DEV_HANDSHAKE_DENY } from "./dev-handshake-path.ts";

/** The variable `crust dev` sets to the bridge's absolute URL. */
export const BRIDGE_URL_VAR = "CRUST_BRIDGE_URL";
/** The variable `crust dev` sets to the page's document token (never the seed). */
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
 * exactly what `dev.url` must not do. The token here is already a non-seeding document token
 * minted by the runtime; this plugin never mints, fetches or otherwise touches the bridge.
 */
export function crust(options: CrustOptions = {}): Plugin {
	const urlVar = options.urlVar ?? BRIDGE_URL_VAR;
	const tokenVar = options.tokenVar ?? BRIDGE_TOKEN_VAR;
	let warned = false;

	// Read per document, not once at config time: the dev server is started
	// before the runtime writes its handshake, so the honest moment to look is
	// when a page is actually served.
	const read = () => {
		const env = {
			url: (process.env[urlVar] ?? "").trim(),
			token: (process.env[tokenVar] ?? "").trim(),
			tokens: undefined as Record<string, string> | undefined,
		};
		// The handshake carries one token per window label. Prefer it when present:
		// an env override is a single main token and cannot express the labels.
		try {
			const file = process.env.CRUST_DEV_FILE ?? devHandshakePath(process.cwd());
			const parsed = JSON.parse(readFileSync(file, "utf8")) as {
				url?: string;
				token?: string;
				tokens?: Record<string, string>;
			};
			return {
				url: (parsed.url ?? "").trim(),
				token: (parsed.token ?? "").trim(),
				tokens: parsed.tokens,
			};
		} catch {
			return env;
		}
	};

	/** The label the page's own URL states, used to select its label-bound token. */
	const labelOf = (ctx: unknown): string | undefined => {
		const raw =
			(ctx as { originalUrl?: unknown; url?: unknown } | undefined)?.originalUrl ??
			(ctx as { url?: unknown } | undefined)?.url;
		if (typeof raw !== "string") return undefined;
		try {
			return new URL(raw, "http://localhost").searchParams.get("window") ?? undefined;
		} catch {
			return undefined;
		}
	};

	return {
		name: "crust",
		apply: "serve",
		// Defence in depth: even if a future change puts a handshake back under the
		// project, the dev server refuses to serve it to a page. A main page must
		// never be able to fetch the other labels' tokens from a static file.
		config: () => ({ server: { fs: { deny: [...DEV_HANDSHAKE_DENY] } } }),
		transformIndexHtml: {
			order: "pre",
			async handler(html, ctx) {
				const { url, token, tokens } = read();
				const label = labelOf(ctx);
				const pageToken =
					label !== undefined && tokens?.[label] !== undefined ? tokens[label] : token;
				if (url.length === 0 || pageToken.length === 0) {
					if (!warned) {
						warned = true;
						console.warn(
							`[crust] ${urlVar}/${tokenVar} are unset and no dev handshake was found. ` +
								"This page gets no window.crust. Start the dev server through `crust dev`.",
						);
					}
					return html;
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
