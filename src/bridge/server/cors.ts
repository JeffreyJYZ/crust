/**
 * The origin gate: own origin, plus any explicitly configured dev origin
 * (`crust dev` / Vite). Absent Origin is refused, never treated as
 * same-origin — that is what stops a local process driving the bridge.
 */

import { CrustError } from "../errors";
import { errorResponse } from "./http.ts";
import type { StartBridgeOptions } from "./types.ts";

export const HOST = "127.0.0.1";

export function normalizeDevOrigins(value: StartBridgeOptions["devOrigin"]): string[] {
	if (value === undefined || value === null) return [];
	if (typeof value === "string") return value.length === 0 ? [] : [value];
	return [...value].filter((origin) => typeof origin === "string" && origin.length > 0);
}

/** Both hostnames a page may have been loaded from; the bind address is the IP. */
function ownOrigins(port: number): string[] {
	return [`http://${HOST}:${port}`, `http://localhost:${port}`];
}

export function corsHeaders(
	origin: string | null,
	devOrigins: readonly string[],
): Record<string, string> | undefined {
	if (origin === null) return undefined;
	if (!devOrigins.includes(origin)) return undefined;
	// The page the bridge serves itself is same-origin and gets no CORS headers,
	// even while a dev origin is configured.
	return { "access-control-allow-origin": origin, vary: "origin" };
}

export function allowedOrigin(
	origin: string | null,
	devOrigins: readonly string[],
	port: number,
): boolean {
	if (origin === null) return false;
	if (ownOrigins(port).includes(origin)) return true;
	return devOrigins.includes(origin);
}

export function preflight(request: Request, devOrigins: readonly string[]): Response {
	const origin = request.headers.get("origin");
	if (origin !== null && devOrigins.includes(origin)) {
		return new Response(null, {
			status: 204,
			headers: {
				"access-control-allow-origin": origin,
				"access-control-allow-methods": "POST, GET, OPTIONS",
				"access-control-allow-headers": "authorization, content-type",
				"access-control-max-age": "600",
				vary: "origin",
			},
		});
	}
	return errorResponse(new CrustError("bad-origin", "preflight not allowed"));
}
