/**
 * The request gate, in the order the bridge has always applied it: preflight,
 * token-free document and assets, then origin, then token, then events or
 * invoke.
 */

import { CrustError } from "../errors";
import { assetBody, documentResponse, hasDocument } from "./assets.ts";
import { allowedOrigin, corsHeaders, preflight } from "./cors.ts";
import type { Events } from "./events.ts";
import { bearer, contentTypeOf, errorResponse, hasExtension } from "./http.ts";
import { invokeRequest, type Run } from "./invoke.ts";
import type { StartBridgeOptions } from "./types.ts";

export const INVOKE_PATH = "/_crust/invoke";
export const EVENTS_PATH = "/_crust/events";

export interface BridgeState {
	options: StartBridgeOptions;
	csp: string;
	token: string;
	devOrigins: readonly string[];
	events: Events;
	/** The bound port. An ephemeral bind only knows it after `serve` returns. */
	port(): number;
	run: Run;
}

export function createHandler(state: BridgeState): (request: Request) => Promise<Response> {
	return async function fetch(request: Request): Promise<Response> {
		const { options, csp, token, devOrigins, events } = state;
		const url = new URL(request.url);
		const origin = request.headers.get("origin");
		const cors = corsHeaders(origin, devOrigins);

		if (request.method === "OPTIONS") return preflight(request, devOrigins);

		// The document and its assets are the only token-free paths: the page
		// cannot hold its own token before it has been served. DESIGN.md §4 is
		// explicit that the built frontend is public — the token protects IPC,
		// not the HTML, JS and CSS the page is made of.
		if (
			(request.method === "GET" || request.method === "HEAD") &&
			!url.pathname.startsWith("/_crust/")
		) {
			try {
				if (url.pathname === "/" || url.pathname === "/index.html") {
					return await documentResponse({ options, csp, token, port: state.port() });
				}
				const body = await assetBody(url.pathname, options);
				if (body !== null) {
					return new Response(body, {
						headers: {
							"content-type": contentTypeOf(url.pathname),
							"cache-control": "no-store",
							"x-content-type-options": "nosniff",
						},
					});
				}
				// A path with no extension that matches no file is a client-side
				// route: serve the document and let the page's router handle it.
				if (!hasExtension(url.pathname) && (await hasDocument(options))) {
					return await documentResponse({ options, csp, token, port: state.port() });
				}
			} catch (error) {
				return errorResponse(error, cors);
			}
		}

		// A request with no Origin is a non-browser local client. Refusing it
		// explicitly is what stops a local process driving the bridge, so the
		// check cannot be skipped by omitting the header.
		if (!allowedOrigin(origin, devOrigins, state.port())) {
			return errorResponse(
				new CrustError("bad-origin", `origin not allowed: ${origin ?? "<absent>"}`),
				cors,
			);
		}

		const headerToken = bearer(request.headers.get("authorization"));
		// EventSource cannot set headers, so the stream also accepts `?token=`.
		const queryToken = url.pathname === EVENTS_PATH ? url.searchParams.get("token") : null;
		if (headerToken !== token && queryToken !== token) {
			return errorResponse(
				new CrustError("unauthorized", "missing or bad bearer token"),
				cors,
			);
		}

		if (url.pathname === EVENTS_PATH && request.method === "GET") {
			return events.stream(state.port(), cors);
		}

		if (url.pathname === INVOKE_PATH && request.method === "POST") {
			return await invokeRequest(request, url, state.run, cors);
		}

		return errorResponse(new CrustError("not-found", url.pathname), cors);
	};
}
