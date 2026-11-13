/**
 * Shared bridge implementation for the crust loopback probe.
 * Everything here is the candidate server crust would actually ship.
 */

export const HOST = "127.0.0.1";
export const TOKEN = "probe-token-" + "7f3c1a9b";

export type Handler = (args: unknown) => unknown;

const handlers = new Map<string, Handler>();

export function command(name: string, fn: Handler) {
	handlers.set(name, fn);
}

/** Test handlers, installed by server.ts / client.ts. */
export function installProbeCommands() {
	command("noop", () => "pong");
	command("echo", (args) => args);
	command("boom", () => {
		throw new Error("handler blew up");
	});
	command("big", (args) => {
		// Return a large JSON payload so response size is measurable.
		const a = args as { kb?: number } | undefined;
		const kb = a?.kb ?? 1024;
		return { ok: true, blob: "x".repeat(kb * 1024) };
	});
}

export interface BridgeOptions {
	/** Origins allowed to call the bridge. `null` = production: same-origin only. */
	devOrigins?: string[] | null;
	/** Interval between SSE pushes, ms. */
	sseIntervalMs?: number;
	/** Bind port. `0` (default) asks the OS for an ephemeral one. */
	port?: number;
}

/**
 * Headers every HTML document the bridge serves carries.
 *
 * `default-src 'self'` is the whole policy: the page and its assets come
 * from this origin, and nothing else may load. `connect-src` is listed
 * separately because the bridge is the page's own API, and an explicit list
 * keeps a future typo from silently widening it.
 */
export const DOCUMENT_HEADERS: Record<string, string> = {
	"content-type": "text/html; charset=utf-8",
	"content-security-policy": [
		"default-src 'self'",
		"script-src 'self' 'unsafe-inline'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data:",
		"connect-src 'self'",
		"base-uri 'none'",
		"form-action 'none'",
		"frame-ancestors 'none'",
	].join("; "),
	"x-content-type-options": "nosniff",
	"referrer-policy": "no-referrer",
	"cache-control": "no-store",
};

export function makeResponse(body: string, status = 200, extra?: Record<string, string>): Response {
	return new Response(body, {
		status,
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"cache-control": "no-store",
			...(extra ?? {}),
		},
	});
}

function errorBody(status: number, code: string, message: string, extra?: Record<string, string>): Response {
	return new Response(JSON.stringify({ ok: false, error: { code, message } }), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", ...(extra ?? {}) },
	});
}

/** CORS headers for a cross-origin dev caller; empty for a same-origin page. */
function corsFor(req: Request, devOrigins: string[] | null, port: number): Record<string, string> | undefined {
	const origin = req.headers.get("origin");
	if (origin === null || origin === `http://${HOST}:${port}`) return undefined;
	if (!devOrigins?.includes(origin)) return undefined;
	return { "access-control-allow-origin": origin, vary: "origin" };
}

/** The security gate. Returns null when allowed, else a Response. */
export function checkRequest(req: Request, url: URL, devOrigins: string[] | null): Response | null {
	// The initial document and its assets are the only token-free paths.
	if (url.pathname === "/" || url.pathname.startsWith("/assets/")) return null;

	const origin = req.headers.get("origin");
	// fetch() always sends Origin, and the page's own origin is the server's.
	// The explicit null check keeps a missing header loud instead of empty-string
	// quietly matching an empty allow-list.
	if (origin === null || !allowOrigin(origin, devOrigins, url.port)) {
		return errorBody(403, "bad-origin", `origin not allowed: ${origin ?? "<absent>"}`);
	}

	const auth = req.headers.get("authorization");
	if (auth !== `Bearer ${TOKEN}`) {
		return errorBody(401, "unauthorized", "missing or bad bearer token");
	}
	return null;
}

export interface ServerHandle {
	url: string;
	port: number;
	/** ms from `Bun.serve` call to the socket accepting. */
	bindMs: number;
	stop: () => Promise<void>;
	server: ReturnType<typeof Bun.serve>;
}

/**
 * Start the bridge. `serveImpl` is injectable so the caller can measure
 * `Bun.serve` itself rather than a wrapper.
 */
export async function startBridge(
	opts: BridgeOptions = {},
	serveImpl: typeof Bun.serve = Bun.serve,
): Promise<ServerHandle> {
	const devOrigins = opts.devOrigins === undefined ? null : opts.devOrigins;
	const sseIntervalMs = opts.sseIntervalMs ?? 20;
	const sseBodies = new Map<string, ReadableStream>();
	const sseCleanup: Array<() => void> = [];
	let nextId = 1;

	installProbeCommands();

	const server = serveImpl({
		hostname: HOST,
		port: opts.port ?? 0,
		idleTimeout: 0,
		async fetch(req) {
			

			// CORS preflight. Only answered for a configured dev origin; the
			// page the server serves itself is same-origin and never preflights.
			if (req.method === "OPTIONS") {
				const origin = req.headers.get("origin");
				if (origin !== null && devOrigins?.includes(origin)) {
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
				return errorBody(403, "bad-origin", "preflight not allowed");
			}
			const url = new URL(req.url);

			// SSE endpoint. Token comes from the query string because
			// EventSource cannot set headers.
			if (url.pathname === "/_crust/events") {
				const token = url.searchParams.get("token");
				if (token !== TOKEN) return errorBody(401, "unauthorized", "bad sse token");
				const peer = req.headers.get("origin");
				if (peer !== null && !allowOrigin(peer, devOrigins, url.port)) {
					return errorBody(403, "bad-origin", "sse origin not allowed");
				}
				const id = String(nextId++);
				const stream = new ReadableStream({
					start(controller) {
						const enc = new TextEncoder();
						let n = 0;
						const send = (event: string, data: string) => {
							controller.enqueue(enc.encode(`event: ${event}\ndata: ${data}\n\n`));
						};
						send("crust:ready", JSON.stringify({ id }));
						const timer = setInterval(() => {
							n++;
							send("tick", JSON.stringify({ id, n }));
							if (n >= 20) {
								clearInterval(timer);
								try {
									controller.close();
								} catch {}
							}
						}, sseIntervalMs);
						sseCleanup.push(() => clearInterval(timer));
					},
					cancel() {
						// page went away
					},
				});
				return new Response(stream, {
					headers: {
						"content-type": "text/event-stream",
						// EventSource cannot set headers, so a cross-origin dev page
						// needs CORS here too, or the stream never opens.
						...(corsFor(req, devOrigins, url.port) ?? {}),
						"cache-control": "no-store",
						connection: "keep-alive",
					},
				});
			}

			// Invoke endpoint.
			if (url.pathname === "/_crust/invoke" && req.method === "POST") {
				const gate = checkRequest(req, url, devOrigins);
				if (gate) return gate;
				const caller = corsFor(req, devOrigins, url.port);
				const text = await req.text();
				if (text.length > 2 * 1024 * 1024) {
					return errorBody(413, "too-large", "payload too large");
				}
				let parsed: { plugin?: string; command?: string; args?: unknown };
				try {
					parsed = JSON.parse(text);
				} catch {
					return errorBody(400, "bad-json", "body is not json");
				}
				if (!parsed?.command) return errorBody(400, "bad-request", "no command");
				const fn = handlers.get(parsed.command);
				if (!fn) return errorBody(404, "unknown-command", parsed.command);
				try {
					const result = await fn(parsed.args);
					return makeResponse(
						JSON.stringify({
							ok: true,
							id: parsed.plugin ?? null,
							result: result === undefined ? null : result,
						}),
						200,
						caller,
					);
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					return errorBody(500, "handler-error", msg, caller);
				}
			}

			// Payload-size probe: echoes byte counts, never the body.
			if (url.pathname === "/_crust/echo-bytes" && req.method === "POST") {
				const gate = checkRequest(req, url, devOrigins);
				if (gate) return gate;
				const buf = new Uint8Array(await req.arrayBuffer());
				return makeResponse(JSON.stringify({ bytes: buf.byteLength }));
			}

			// Deliberately blocking handler, for the blocking probe.
			if (url.pathname === "/_crust/block" && req.method === "POST") {
				const gate = checkRequest(req, url, devOrigins);
				if (gate) return gate;
				const until = Date.now() + 300;
				while (Date.now() < until) {}
				return makeResponse("blocked");
			}

			// Plain document, no token needed. This is the response that
			// carries CSP: the page the bridge serves must be told what it may load.
			if (url.pathname === "/") {
				return new Response("<!doctype html><title>crust probe</title><p>ok", {
					headers: { ...DOCUMENT_HEADERS },
				});
			}
			return errorBody(404, "not-found", url.pathname);
		},
	});

	const port = server.port ?? 0;
	return {
		url: `http://${HOST}:${port}`,
		port,
		bindMs: 0,
		stop: async () => {
			for (const c of sseCleanup) c();
			await server.stop(true);
		},
		server,
	};
}

/** A localhost origin that is never allowed (port 1 is not listening). */
const FOREIGN_ORIGIN = "http://127.0.0.2:1";

function allowOrigin(origin: string, devOrigins: string[] | null, port: number): boolean {
	// Always accept the bridge's own origin and any configured dev origins.
	// Never accept anything else.
	if (origin === `http://${HOST}:${port}` || origin === `http://localhost:${port}`) return true;
	if (devOrigins?.includes(origin)) return true;
	return false;
}