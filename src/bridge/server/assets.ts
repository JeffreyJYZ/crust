/**
 * The document and asset half of the bridge: the bytes a page is made of.
 *
 * Assets are served without a token because they carry no credential and the page requests them with
 * bare `<script src>` URLs. The document is not in that class: `handler.ts` demands `?token=` before
 * it is served, and this module therefore never writes the token into the HTML — the page reads it
 * back out of its own `location.search`.
 */

import { resolve, sep } from "node:path";
import { bootstrapSource, type CrustConfig } from "../client";
import { CrustError } from "../errors";
import { RELOAD_ENV } from "./events.ts";
import { defaultCsp, nonceSource, stampInlineScripts } from "./csp.ts";
import { headersFor } from "./http.ts";
import type { StartBridgeOptions } from "./types.ts";

/** Read an embedded or on-disk asset as text, or `null` when it does not exist. */
export async function assetText(
	pathname: string,
	options: StartBridgeOptions,
): Promise<string | null> {
	const body = await assetBody(pathname, options);
	if (body === null) return null;
	if (typeof body === "string") return body;
	if (body instanceof Blob) return body.text();
	return new TextDecoder().decode(body);
}

/** Read an embedded or on-disk asset, or `null` when it does not exist. */
export async function assetBody(
	pathname: string,
	options: StartBridgeOptions,
): Promise<string | Uint8Array | ArrayBuffer | Blob | null> {
	const key = decodeURIComponent(pathname);
	// Both separators, because `join` on Windows treats `\` as one: a `%5c` segment decodes
	// after the URL parser has run, so splitting on `/` alone lets `..\..\secret` through.
	if (key.includes("\0") || key.split(/[\\/]/).some((part) => part === "..")) {
		throw new CrustError("bad-request", `bad asset path: ${pathname}`);
	}
	const relative = key.replace(/^\/+/, "");
	if (options.assets !== undefined) {
		for (const candidate of [key, `/${relative}`, relative]) {
			if (Object.hasOwn(options.assets, candidate)) return options.assets[candidate] ?? null;
		}
	}
	if (options.root !== undefined && relative.length > 0) {
		// Defence in depth: even with the separator fix, a candidate that resolves outside the
		// root is refused rather than served. `resolve` normalises both sides and the trailing
		// separator keeps `/root-evil` from matching a `/root` prefix.
		const root = resolve(options.root);
		const file = resolve(root, relative);
		if (file !== root && !file.startsWith(`${root}${sep}`)) {
			throw new CrustError("bad-request", `asset path escapes the root: ${pathname}`);
		}
		const candidate = Bun.file(file);
		if (await candidate.exists()) return candidate;
	}
	return null;
}

/** Whether a document exists to fall back to. No document means no fallback. */
export async function hasDocument(options: StartBridgeOptions): Promise<boolean> {
	if (options.indexHtml !== undefined) return true;
	return (await assetBody("/index.html", options)) !== null;
}

/**
 * Put `snippet` where the parser reaches it before any page script.
 *
 * `nonce` is the response's own value, and a snippet that carries it is the only inline script a
 * served document may run: `script-src` names that nonce and nothing else, so an injected `<script>`
 * without it is refused by the engine.
 */
export function injectBootstrap(html: string, snippet: string, nonce: string): string {
	const tag = `<script nonce="${nonce}">${snippet}</script>`;
	const headClose = /<\/head\s*>/i;
	if (headClose.test(html)) return html.replace(headClose, () => `${tag}</head>`);
	const bodyOpen = /<body[^>]*>/i;
	if (bodyOpen.test(html)) return html.replace(bodyOpen, (match) => `${match}${tag}`);
	return `${tag}${html}`;
}

const EMPTY_DOCUMENT = [
	"<!doctype html>",
	"<html>",
	'<head><meta charset="utf-8"><title>crust</title></head>',
	"<body><p>crust bridge is running, but no frontend was given to startBridge.</p></body>",
	"</html>",
].join("\n");

export async function documentResponse(handle: {
	options: StartBridgeOptions;
	/** An app's own policy; absent means the default policy plus this response's nonce. */
	csp: string | undefined;
	port: number;
	/** The window this document is for, read from the request URL by `handler.ts`. */
	windowLabel?: string;
}): Promise<Response> {
	const { options, csp, port, windowLabel } = handle;
	// Plain-HTML dev edits public/index.html under a running bridge, but `indexHtml` is the
	// snapshot read at startup. When the dev reload signal is active, read fresh from disk so
	// the reload the client performs actually shows the edit. A built app has no root and no
	// signal, so it keeps the embedded snapshot.
	const live =
		options.root !== undefined && process.env[RELOAD_ENV] !== undefined
			? await assetText("/index.html", options)
			: null;
	const html =
		live ?? options.indexHtml ?? (await assetText("/index.html", options)) ?? EMPTY_DOCUMENT;
	// The label the bridge itself saw on the document request, not one the page claims: it is
	// written into the page's config so `window.label` can answer the window that asked for this
	// document. A request that named none injects none, and the command refuses by name.
	//
	// The token is deliberately *not* here: the handler only serves this document to a request
	// that already presented it, and the page reads it back out of `location.search`. Serialising
	// it into the HTML is what made it decorative — any local process could fetch `/` and read it.
	const config: CrustConfig = {
		baseUrl: "",
		port,
		...(windowLabel ? { window: windowLabel } : {}),
	};
	// One nonce per response, never cached: the value the CSP admits and the value the bootstrap
	// carries are the same string, so two documents never share an inline script's permission.
	const nonce = nonceSource();
	// The document's own inline scripts — the runtime's `invoke` shim chief among them — are
	// authored markup, so they are stamped here. A tag a *later* injection adds carries no nonce
	// and `script-src 'self' 'nonce-…'` refuses it; that is the door this closes.
	// The snippet is the bootstrap's *source*, not a `<script>` element: `injectBootstrap` builds
	// the element around it. Passing an element nests one script inside another, and the parser
	// ends the outer script at the inner `</script>`, so the page receives a truncated body that
	// throws on its first `<` and `window.crust` never installs.
	const injected = injectBootstrap(
		stampInlineScripts(html, nonce),
		bootstrapSource(config),
		nonce,
	);
	// An app's `security.csp` wins whole. The nonce is still computed for the bootstrap above, and a
	// caller who replaces `script-src` owns the consequence — rewriting their string would silently
	// change a policy they wrote deliberately.
	return new Response(injected, { headers: headersFor(csp ?? defaultCsp(nonce)) });
}
