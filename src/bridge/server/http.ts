/**
 * Response plumbing shared by every route: one JSON envelope, one error
 * envelope, and the content-type table the asset route serves from.
 */

import { CrustError, isCrustError, toCrustError, type SerializedCrustError } from "../errors";

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".wasm": "application/wasm",
	".webmanifest": "application/manifest+json",
};

export function headersFor(csp: string): Record<string, string> {
	return {
		"content-type": "text/html; charset=utf-8",
		"content-security-policy": csp,
		"x-content-type-options": "nosniff",
		"referrer-policy": "no-referrer",
		"cache-control": "no-store",
	};
}

export function jsonResponse(
	body: unknown,
	status = 200,
	extra?: Record<string, string>,
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
			...(extra ?? {}),
		},
	});
}

export function errorResponse(error: unknown, extra?: Record<string, string>): Response {
	const crustError: CrustError = isCrustError(error) ? error : toCrustError(error);
	const serialized: SerializedCrustError = crustError.toJSON();
	return jsonResponse({ ok: false, error: serialized }, crustError.status, extra);
}

export function contentTypeOf(pathname: string): string {
	const dot = pathname.lastIndexOf(".");
	const ext = dot === -1 ? "" : pathname.slice(dot).toLowerCase();
	return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/**
 * A path whose last segment has no dot is a client-side route, not a file:
 * `/settings` falls back to the document so a page's own router can see it,
 * while `/missing.js` is a genuinely absent asset.
 */
export function hasExtension(pathname: string): boolean {
	const last = pathname.slice(pathname.lastIndexOf("/") + 1);
	return last.includes(".");
}

export function bearer(authorization: string | null): string | null {
	if (authorization === null) return null;
	const prefix = "Bearer ";
	return authorization.startsWith(prefix) ? authorization.slice(prefix.length) : null;
}
