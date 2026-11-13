/**
 * The bridge server: `Bun.serve` on loopback, one token, one origin check.
 *
 * Measured on Bun 1.4.4, macOS 27.0.1 (research/bridge.md):
 *   - invoke round-trip, 200 calls over fresh sockets: median 0.119 ms, p99 1.276 ms;
 *     the same-process floor is 0.0005 ms, so the socket is 99.6% of the cost;
 *   - a reused connection costs 0.045 ms, which is why the page's keep-alive
 *     `fetch` connection is the number that matters;
 *   - an ephemeral-port bind takes 0.11 ms, a stopped bridge rebinds the same
 *     port in 0.45 ms, and SSE delivered 20 of 20 frames in order at a 20.38 ms
 *     median gap with no coalescing;
 *   - one-megabyte bodies take 2.4 ms as JSON and 1.8 ms as binary.
 *
 * Security posture: ephemeral port + per-launch bearer token + an Origin check
 * that refuses an absent header + an explicit CSP. Loopback is reachable by any
 * local process, so the token is what actually protects the bridge.
 */

import { join } from "node:path";
import { bootstrapSource, type CrustConfig } from "./client";
import { CrustError, isCrustError, toCrustError, type SerializedCrustError } from "./errors";
import type { PluginContext } from "../plugins/define";
import { type CommandHandler, isNotImplemented } from "../plugins/define";
import { handlerMap, type HandlerSource } from "../plugins/registry";

export const HOST = "127.0.0.1";
export const INVOKE_PATH = "/_crust/invoke";
export const EVENTS_PATH = "/_crust/events";

/** Bodies over this size are refused before parsing, as the probe measured. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * The measured policy, verbatim. `connect-src 'self'` is the line that lets the
 * page call the bridge and hold the event stream open; without it every invoke
 * is a CSP violation in the console rather than a network error.
 */
export const DEFAULT_CSP = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-inline'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data:",
	"connect-src 'self'",
	"base-uri 'none'",
	"form-action 'none'",
	"frame-ancestors 'none'",
].join("; ");

export type AssetTable = Record<string, string | Uint8Array | ArrayBuffer | Blob>;

export interface StartBridgeOptions {
	/** Plugins, a registry, or a flat `"plugin.command"` handler table. */
	handlers: HandlerSource;
	/** Override the policy. Defaults to `DEFAULT_CSP`. */
	csp?: string;
	/** Origins allowed to call from another origin (`crust dev` / Vite). */
	devOrigin?: string | readonly string[] | null;
	/** Built frontend embedded in the binary: request path -> body. */
	assets?: AssetTable;
	/** Built frontend on disk, for development and for `crust build` output. */
	root?: string;
	/** Explicit document, ahead of `assets["/index.html"]` and `root/index.html`. */
	indexHtml?: string;
	/** Bind port. `0` (the default) asks the OS for an ephemeral one. */
	port?: number;
}

export interface BridgeHandle {
	readonly port: number;
	readonly token: string;
	readonly url: string;
	/** Push an event to every connected page. */
	emit(event: string, data: unknown): void;
	stop(): Promise<void>;
	readonly server: ReturnType<typeof Bun.serve>;
}

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

function normalizeDevOrigins(value: StartBridgeOptions["devOrigin"]): string[] {
	if (value === undefined || value === null) return [];
	if (typeof value === "string") return value.length === 0 ? [] : [value];
	return [...value].filter((origin) => typeof origin === "string" && origin.length > 0);
}

/** Both hostnames a page may have been loaded from; the bind address is the IP. */
function ownOrigins(port: number): string[] {
	return [`http://${HOST}:${port}`, `http://localhost:${port}`];
}

function headersFor(csp: string): Record<string, string> {
	return {
		"content-type": "text/html; charset=utf-8",
		"content-security-policy": csp,
		"x-content-type-options": "nosniff",
		"referrer-policy": "no-referrer",
		"cache-control": "no-store",
	};
}

function jsonResponse(body: unknown, status = 200, extra?: Record<string, string>): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
			...(extra ?? {}),
		},
	});
}

function errorResponse(error: unknown, extra?: Record<string, string>): Response {
	const crustError: CrustError = isCrustError(error) ? error : toCrustError(error);
	const serialized: SerializedCrustError = crustError.toJSON();
	return jsonResponse({ ok: false, error: serialized }, crustError.status, extra);
}

function contentTypeOf(pathname: string): string {
	const dot = pathname.lastIndexOf(".");
	const ext = dot === -1 ? "" : pathname.slice(dot).toLowerCase();
	return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/**
 * A path whose last segment has no dot is a client-side route, not a file:
 * `/settings` falls back to the document so a page's own router can see it,
 * while `/missing.js` is a genuinely absent asset.
 */
function hasExtension(pathname: string): boolean {
	const last = pathname.slice(pathname.lastIndexOf("/") + 1);
	return last.includes(".");
}

/** Whether a document exists to fall back to. No document means no fallback. */
async function hasDocument(options: StartBridgeOptions): Promise<boolean> {
	if (options.indexHtml !== undefined) return true;
	return (await assetBody("/index.html", options)) !== null;
}

interface Subscriber {
	enqueue(frame: string): void;
}

function sseFrame(event: string, data: unknown): string {
	let payload: string;
	try {
		payload = data === undefined ? "null" : JSON.stringify(data);
	} catch {
		payload = JSON.stringify(String(data));
	}
	return `event: ${event}\ndata: ${payload}\n\n`;
}

function corsHeaders(
	origin: string | null,
	devOrigins: readonly string[],
): Record<string, string> | undefined {
	if (origin === null) return undefined;
	if (!devOrigins.includes(origin)) return undefined;
	// The page the bridge serves itself is same-origin and gets no CORS headers,
	// even while a dev origin is configured.
	return { "access-control-allow-origin": origin, vary: "origin" };
}

function allowedOrigin(
	origin: string | null,
	devOrigins: readonly string[],
	port: number,
): boolean {
	if (origin === null) return false;
	if (ownOrigins(port).includes(origin)) return true;
	return devOrigins.includes(origin);
}

function preflight(request: Request, devOrigins: readonly string[]): Response {
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

function bearer(authorization: string | null): string | null {
	if (authorization === null) return null;
	const prefix = "Bearer ";
	return authorization.startsWith(prefix) ? authorization.slice(prefix.length) : null;
}

/** Read an embedded or on-disk asset as text, or `null` when it does not exist. */
async function assetText(pathname: string, options: StartBridgeOptions): Promise<string | null> {
	const body = await assetBody(pathname, options);
	if (body === null) return null;
	if (typeof body === "string") return body;
	if (body instanceof Blob) return body.text();
	return new TextDecoder().decode(body);
}

/** Read an embedded or on-disk asset, or `null` when it does not exist. */
async function assetBody(
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

function injectBootstrap(html: string, snippet: string): string {
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

async function documentResponse(handle: {
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

/**
 * Start the bridge.
 *
 * `port: 0` lets the OS choose, so two instances cannot collide; the returned
 * `port` is the real one. `stop()` closes every event stream and releases the
 * port immediately (measured rebind 0.45 ms), and a stopped bridge does not
 * keep the process alive.
 */
export function startBridge(options: StartBridgeOptions): BridgeHandle {
	const handlers = handlerMap(options.handlers);
	if (handlers.size === 0) {
		throw new CrustError("bad-request", "startBridge needs at least one handler");
	}
	const token = crypto.randomUUID();
	const csp = options.csp ?? DEFAULT_CSP;
	const devOrigins = normalizeDevOrigins(options.devOrigin);
	const subscribers = new Set<Subscriber>();
	const cleanups = new Set<() => void>();
	let port = options.port ?? 0;

	function emit(event: string, data: unknown): void {
		const frame = sseFrame(event, data);
		for (const subscriber of subscribers) {
			try {
				subscriber.enqueue(frame);
			} catch {
				subscribers.delete(subscriber);
			}
		}
	}

	const ctx: PluginContext = { emit };

	async function run(plugin: string, command: string, args: unknown): Promise<unknown> {
		const handler: CommandHandler | undefined = handlers.get(`${plugin}.${command}`);
		if (!handler) {
			throw new CrustError("unknown-command", `${plugin}.${command}`);
		}
		let result: unknown;
		try {
			result = await handler(args, ctx);
		} catch (error) {
			throw toCrustError(error);
		}
		if (isNotImplemented(result)) {
			throw new CrustError("not-implemented", result.message, { requires: result.requires });
		}
		return result === undefined ? null : result;
	}

	const server = Bun.serve({
		hostname: HOST,
		port,
		// Bun's 10 s default cuts an idle event stream mid-flight (measured trap 2).
		idleTimeout: 0,
		async fetch(request) {
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
						return await documentResponse({ options, csp, token, port });
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
						return await documentResponse({ options, csp, token, port });
					}
				} catch (error) {
					return errorResponse(error, cors);
				}
			}

			// A request with no Origin is a non-browser local client. Refusing it
			// explicitly is what stops a local process driving the bridge, so the
			// check cannot be skipped by omitting the header.
			if (!allowedOrigin(origin, devOrigins, port)) {
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
				let detached: () => void = () => {};
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						const encoder = new TextEncoder();
						const subscriber: Subscriber = {
							enqueue(frame: string) {
								controller.enqueue(encoder.encode(frame));
							},
						};
						subscribers.add(subscriber);
						subscriber.enqueue(sseFrame("crust:ready", { port, protocol: 1 }));
						detached = () => {
							subscribers.delete(subscriber);
							try {
								controller.close();
							} catch {
								// already closed
							}
						};
						cleanups.add(detached);
					},
					cancel() {
						detached();
					},
				});
				return new Response(stream, {
					headers: {
						"content-type": "text/event-stream",
						"cache-control": "no-store",
						connection: "keep-alive",
						...(cors ?? {}),
					},
				});
			}

			if (url.pathname === INVOKE_PATH && request.method === "POST") {
				try {
					const declared = Number(request.headers.get("content-length") ?? "0");
					if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
						throw new CrustError("too-large", "payload too large");
					}

					const contentType = request.headers.get("content-type") ?? "";
					const isBinary = contentType.length > 0 && !contentType.includes("json");

					if (isBinary) {
						// Binary form: the body is the argument, the command rides in the
						// query string. One route carries both payload kinds, and the
						// 1 MB binary path measured 1.8 ms.
						const plugin = url.searchParams.get("plugin");
						const command = url.searchParams.get("command");
						if (plugin === null || command === null) {
							throw new CrustError(
								"bad-request",
								"binary invoke needs ?plugin= and ?command=",
							);
						}
						const bytes = new Uint8Array(await request.arrayBuffer());
						if (bytes.byteLength > MAX_BODY_BYTES) {
							throw new CrustError("too-large", "payload too large");
						}
						return jsonResponse(
							{ ok: true, result: await run(plugin, command, bytes) },
							200,
							cors,
						);
					}

					const text = await request.text();
					if (text.length > MAX_BODY_BYTES) {
						throw new CrustError("too-large", "payload too large");
					}
					let parsed: { plugin?: unknown; command?: unknown; args?: unknown };
					try {
						parsed = JSON.parse(text) as {
							plugin?: unknown;
							command?: unknown;
							args?: unknown;
						};
					} catch {
						throw new CrustError("bad-json", "body is not json");
					}
					if (typeof parsed.plugin !== "string" || typeof parsed.command !== "string") {
						throw new CrustError("bad-request", "body needs { plugin, command, args }");
					}
					return jsonResponse(
						{ ok: true, result: await run(parsed.plugin, parsed.command, parsed.args) },
						200,
						cors,
					);
				} catch (error) {
					return errorResponse(error, cors);
				}
			}

			return errorResponse(new CrustError("not-found", url.pathname), cors);
		},
	});

	port = server.port ?? port;

	return {
		port,
		token,
		url: `http://${HOST}:${port}`,
		server,
		emit,
		async stop() {
			for (const cleanup of cleanups) cleanup();
			cleanups.clear();
			subscribers.clear();
			await server.stop(true);
		},
	};
}
