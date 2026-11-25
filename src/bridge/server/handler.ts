/**
 * The request gate, in the order the bridge has always applied it: preflight,
 * asset, then the document (token required), then origin, then token, then events
 * or invoke.
 *
 * The document is the one route that *carries* a credential, so it is the one
 * route that demands one before serving anything: `windowUrl` puts `?token=` on
 * every navigation URL, and a request without it — or with a wrong one — answers
 * `401`. That is what stops a local process from fetching `/` and reading the
 * bearer token out of the HTML, which made the token decorative.
 * Assets stay token-free: they hold no credential, and the page requests them
 * with plain `<script src>` URLs that carry no query string.
 */

import { CrustError } from "../errors";
import { logEvent } from "@/logging/logger";
import { refuseRecord } from "@/logging/records";
import { TOKEN_PARAM, tokenFromSearch, windowLabelFromSearch } from "../window-identity.ts";
import { assetBody, documentResponse, hasDocument } from "./assets.ts";
import { allowedOrigin, corsHeaders, preflight } from "./cors.ts";
import { mintDocumentToken } from "./document-tokens.ts";
import { bearer, contentTypeOf, errorResponse, hasExtension } from "./http.ts";
import { invokeRequest } from "./invoke.ts";
import { PAGE_LOG_PATH, pageLogRequest } from "./page-log.ts";
import type { BridgeState } from "./state.ts";

export const INVOKE_PATH = "/_crust/invoke";
export const EVENTS_PATH = "/_crust/events";

export function createHandler(state: BridgeState): (request: Request) => Promise<Response> {
	// The process token is the only seed unless the caller says otherwise. Keep it explicit: a
	// credential handed to a page is never allowed to mint a token for a label of the page's choosing.
	const seeds = state.seedTokens ?? new Set([state.token]);
	const { ledger } = state;

	return async function fetch(request: Request): Promise<Response> {
		const { options, csp, token, devOrigins, events } = state;
		const url = new URL(request.url);
		const origin = request.headers.get("origin");
		const cors = corsHeaders(origin, devOrigins);

		if (request.method === "OPTIONS") return preflight(request, devOrigins);

		// Every document response is gated on the same token its navigation URL carries: the page
		// reads it back out of `location.search`, and a request with none — or a wrong one —
		// answers `401` instead of the HTML. That is what keeps the credential out of the reach of
		// a local process that merely fetches `/`.
		const serveDocument = async (): Promise<Response> => {
			const presented = tokenFromSearch(url.search);
			if (presented === undefined || !state.labels.has(presented)) {
				return errorResponse(
					new CrustError("unauthorized", "missing or bad document token"),
					cors,
				);
			}
			const label = windowLabelFromSearch(url.search);
			// Only a seed token may mint, and only on a real navigation (a top-level GET carries no
			// Origin; a page's `fetch` does). By default that is the host's process token alone: it
			// never reaches a page, because `crust dev` injects a minted document token instead and
			// `window.create` replaces any page-chosen `?window=` before the seed is appended.
			// Minting from a bound token would let a page holding `main` ask for `?window=admin` and
			// read the admin token out of the redirect. A document token only re-serves its document.
			if (seeds.has(presented) && origin === null) {
				const documentToken = mintDocumentToken(ledger, label);
				const location = new URL(request.url);
				location.searchParams.set(TOKEN_PARAM, documentToken);
				// Absolute, always. A path beginning `//` is protocol-relative: emitting it as a
				// relative Location handed the freshly minted token to that foreign host.
				// `new URL` keeps the path byte-exact, so the document still resolves on this bridge.
				return new Response(null, {
					status: 302,
					headers: { location: location.toString() },
				});
			}
			return await documentResponse({
				options,
				csp,
				port: state.port(),
				windowLabel: label,
			});
		};

		// The document is the one route that carries a credential, so it is the one route that
		// demands one before serving anything. Every navigation URL `windowUrl` builds carries
		// `?token=`, and the page reads it back out of `location.search`; a request with none, or
		// with a wrong one, answers `401` and never the page.
		if (
			(request.method === "GET" || request.method === "HEAD") &&
			!url.pathname.startsWith("/_crust/")
		) {
			try {
				if (!allowedOrigin(origin, devOrigins, state.port())) {
					logEvent(refuseRecord({ reason: "origin", detail: origin ?? "absent" }));
					return errorResponse(
						new CrustError("bad-origin", `origin not allowed: ${origin ?? "<absent>"}`),
						cors,
					);
				}
				if (url.pathname === "/" || url.pathname === "/index.html") {
					return await serveDocument();
				}
				// Assets stay token-free: they carry no credential and the page requests them with
				// bare `<script src>` URLs.
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
				// A path with no extension that matches no file is a client-side route: serve the
				// document and let the page's router handle it.
				if (!hasExtension(url.pathname) && (await hasDocument(options))) {
					return await serveDocument();
				}
			} catch (error) {
				return errorResponse(error, cors);
			}
		}

		// A request with no Origin is not a cross-origin request, so it is not the
		// origin gate's business: WebKitGTK's EventSource sends none on a
		// same-origin GET, and the token below is the credential either way. A
		// *present* and foreign Origin is a hostile page, and stays refused.
		if (!allowedOrigin(origin, devOrigins, state.port())) {
			logEvent(refuseRecord({ reason: "origin", detail: origin ?? "absent" }));
			return errorResponse(
				new CrustError("bad-origin", `origin not allowed: ${origin ?? "<absent>"}`),
				cors,
			);
		}

		const headerToken = bearer(request.headers.get("authorization"));
		// EventSource cannot set headers, so the stream also accepts `?token=`.
		const queryToken = url.pathname === EVENTS_PATH ? url.searchParams.get("token") : null;
		// Only tokens the bridge issued are credentials: the process token for a dev-server page,
		// or a per-document token minted by `serveDocument`. A token that was never issued is refused
		// even when it is a well-formed UUID a page invented.
		const issued = (value: string | null): value is string =>
			value !== null && state.labels.has(value);
		if (!issued(headerToken) && !issued(queryToken)) {
			logEvent(refuseRecord({ reason: "token", detail: url.pathname }));
			return errorResponse(
				new CrustError("unauthorized", "missing or bad bearer token"),
				cors,
			);
		}

		if (url.pathname === EVENTS_PATH && request.method === "GET") {
			return events.stream(state.port(), cors);
		}

		if (url.pathname === PAGE_LOG_PATH && request.method === "POST") {
			return await pageLogRequest(
				request,
				cors,
				state.labels.get(headerToken ?? queryToken ?? token),
			);
		}

		if (url.pathname === INVOKE_PATH && request.method === "POST") {
			// The label bound to the credential is the only authority for the capability gate.
			// `invokeRequest` still reads the body/query label as a routing hint for `ctx.window`.
			const credential = headerToken ?? queryToken ?? token;
			const authority = state.labels.get(credential);
			return await invokeRequest(request, url, state.run, cors, authority, credential);
		}

		return errorResponse(new CrustError("not-found", url.pathname), cors);
	};
}
