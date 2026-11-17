/**
 * The bridge server: `Bun.serve` on loopback, one token, one origin check. Measured on Bun 1.4.4 / macOS 27.0.1 (`research/bridge.md`): round-trip median 0.119 ms and p99 1.276 ms over 200 fresh-socket calls against a 0.0005 ms same-process floor, 0.045 ms on a reused connection, an ephemeral bind in 0.11 ms, a stopped bridge rebinding in 0.45 ms, SSE 20/20 frames in order at a 20.38 ms median gap, and 1 MB bodies at 2.4 ms JSON / 1.8 ms binary.
 * Security posture: ephemeral port + per-launch bearer token + an Origin check that refuses a *present* and foreign header and allows an absent one (a browser always sends `Origin` on a cross-origin request; WebKitGTK's `EventSource` sends none on a same-origin GET) + an explicit CSP. Loopback is reachable by any local process, so the token is what actually protects IPC — and the document route, which carries that token in its inline bootstrap, *requires the same token in its own query string* before it will serve anything, so fetching `/` yields a `401` rather than a credential. The residual is a process that can read the app's own launch arguments, its `.crust/dev.json` handshake (0600) or the page's URL: those hold the token by design, and the boundary is the OS account.
 */

import type { PluginContext } from "../plugins/define";
import { handlerMap } from "../plugins/registry";
import { CrustError } from "./errors";
import { HOST, normalizeDevOrigins } from "./server/cors.ts";
import { Events } from "./server/events.ts";
import { createHandler, EVENTS_PATH, INVOKE_PATH } from "./server/handler.ts";
import { compileCapabilities } from "./server/capabilities.ts";
import { createRunner } from "./server/invoke.ts";
import type { BridgeHandle, StartBridgeOptions } from "./server/types.ts";

export { HOST, EVENTS_PATH, INVOKE_PATH };
export type { AssetTable, BridgeHandle, BridgeTarget, StartBridgeOptions } from "./server/types.ts";

/**
 * The measured policy, verbatim. `connect-src 'self'` is the line that lets the
 * page call the bridge and hold the event stream open; without it every invoke
 * is a CSP violation in the console rather than a network error.
 *
 * The document route does not use this string as-is: `documentResponse` builds
 * `defaultCsp(nonce)` so the injected bootstrap is the only inline script the
 * page may run. See `server/csp.ts`.
 */
export { DEFAULT_CSP, defaultCsp } from "./server/csp.ts";

/**
 * Start the bridge. `port: 0` lets the OS choose, so two instances cannot collide, and the returned `port` is the real one. `stop()` closes every event stream and releases the port immediately (measured rebind 0.45 ms); a stopped bridge does not keep the process alive.
 */
export function startBridge(options: StartBridgeOptions): BridgeHandle {
	const handlers = handlerMap(options.handlers);
	if (handlers.size === 0) {
		throw new CrustError("bad-request", "startBridge needs at least one handler");
	}
	const token = crypto.randomUUID();
	const devOrigins = normalizeDevOrigins(options.devOrigin);
	const events = new Events();
	let port = options.port ?? 0;

	const emit = (event: string, data: unknown): void => events.emit(event, data);
	const ctx: PluginContext = { emit };
	// Resolved once at start, never per call: the invoke path reads a compiled table, so a request
	// costs one map lookup plus up to a few literal compares, and the config cannot be mutated
	// underneath a running bridge.
	const capabilities = compileCapabilities(options.security);
	const state = {
		options,
		// Only the app's own override: the document route builds the default policy per response so
		// it can carry a nonce the bootstrap shares.
		csp: options.csp,
		token,
		devOrigins,
		events,
		port: () => port,
		run: createRunner(handlers, ctx, capabilities),
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
