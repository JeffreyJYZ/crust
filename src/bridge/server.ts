/**
 * The bridge server: `Bun.serve` on loopback, one token, one origin check. Measured on Bun 1.4.4 / macOS 27.0.1 (`research/bridge.md`): round-trip median 0.119 ms and p99 1.276 ms over 200 fresh-socket calls against a 0.0005 ms same-process floor, 0.045 ms on a reused connection, an ephemeral bind in 0.11 ms, a stopped bridge rebinding in 0.45 ms, SSE 20/20 frames in order at a 20.38 ms median gap, and 1 MB bodies at 2.4 ms JSON / 1.8 ms binary.
 * Security posture: ephemeral port + per-launch bearer token + an Origin check refusing an absent header + an explicit CSP. Loopback is reachable by any local process, so the token is what actually protects the bridge.
 */

import type { PluginContext } from "../plugins/define";
import { handlerMap } from "../plugins/registry";
import { CrustError } from "./errors";
import { HOST, normalizeDevOrigins } from "./server/cors.ts";
import { Events } from "./server/events.ts";
import { createHandler, EVENTS_PATH, INVOKE_PATH } from "./server/handler.ts";
import { createRunner } from "./server/invoke.ts";
import type { BridgeHandle, StartBridgeOptions } from "./server/types.ts";

export { HOST, EVENTS_PATH, INVOKE_PATH };
export type { AssetTable, BridgeHandle, StartBridgeOptions } from "./server/types.ts";

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

/**
 * Start the bridge. `port: 0` lets the OS choose, so two instances cannot collide, and the returned `port` is the real one. `stop()` closes every event stream and releases the port immediately (measured rebind 0.45 ms); a stopped bridge does not keep the process alive.
 */
export function startBridge(options: StartBridgeOptions): BridgeHandle {
	const handlers = handlerMap(options.handlers);
	if (handlers.size === 0) {
		throw new CrustError("bad-request", "startBridge needs at least one handler");
	}
	const token = crypto.randomUUID();
	const csp = options.csp ?? DEFAULT_CSP;
	const devOrigins = normalizeDevOrigins(options.devOrigin);
	const events = new Events();
	let port = options.port ?? 0;

	const emit = (event: string, data: unknown): void => events.emit(event, data);
	const ctx: PluginContext = { emit };
	const state = {
		options,
		csp,
		token,
		devOrigins,
		events,
		port: () => port,
		run: createRunner(handlers, ctx),
	};

	const server = Bun.serve({
		hostname: HOST,
		port,
		// Bun's 10 s default cuts an idle event stream mid-flight (measured trap 2).
		idleTimeout: 0,
		fetch: createHandler(state),
	});

	port = server.port ?? port;

	return {
		port,
		token,
		url: `http://${HOST}:${port}`,
		server,
		emit,
		async stop() {
			events.stop();
			await server.stop(true);
		},
	};
}
