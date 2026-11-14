/**
 * The document and asset half of the bridge: everything the page can fetch
 * without a token, because the page cannot hold its own token before it has
 * been served. `site/app/docs/design/page.mdx` is explicit that the built frontend is public —
 * the token protects IPC, not the HTML, JS and CSS the page is made of.
 */

import { join } from "node:path";
import { bootstrapSource, type CrustConfig } from "../client";
import { CrustError } from "../errors";
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
	if (key.includes("\0") || key.split("/").some((part) => part === "..")) {
		throw new CrustError("bad-request", `bad asset path: ${pathname}`);
	}
	const relative = key.replace(/^\/+/, "");
	if (options.assets !== undefined) {
		for (const candidate of [key, `/${relative}`, relative]) {
			if (Object.hasOwn(options.assets, candidate)) return options.assets[candidate] ?? null;
		}
	}
	if (options.root !== undefined && relative.length > 0) {
		const file = Bun.file(join(options.root, relative));
		if (await file.exists()) return file;
	}
	return null;
}

/** Whether a document exists to fall back to. No document means no fallback. */
export async function hasDocument(options: StartBridgeOptions): Promise<boolean> {
	if (options.indexHtml !== undefined) return true;
	return (await assetBody("/index.html", options)) !== null;
}

export function injectBootstrap(html: string, snippet: string): string {
	const headClose = /<\/head\s*>/i;
	if (headClose.test(html)) return html.replace(headClose, () => `${snippet}</head>`);
	const bodyOpen = /<body[^>]*>/i;
	if (bodyOpen.test(html)) return html.replace(bodyOpen, (tag) => `${tag}${snippet}`);
	return `${snippet}${html}`;
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
	csp: string;
	token: string;
	port: number;
}): Promise<Response> {
	const { options, csp, token, port } = handle;
	const html = options.indexHtml ?? (await assetText("/index.html", options)) ?? EMPTY_DOCUMENT;
	const config: CrustConfig = { baseUrl: "", token, port };
	const injected = injectBootstrap(html, `<script>${bootstrapSource(config)}</script>`);
	return new Response(injected, { headers: headersFor(csp) });
}
