/**
 * The page-side half of the bridge.
 *
 * This file is served as the bootstrap: the server takes `installCrust`'s own
 * source (`Function.prototype.toString`) and calls it with the token, so the
 * page and the server share one implementation rather than two drifting copies.
 * The consequence is a hard constraint: `installCrust` must stay self-contained
 * and reference nothing from module scope. Every helper lives inside it.
 *
 * Cost, measured on Bun 1.4.4: an invoke round-trip is a median 0.119 ms and a
 * p99 1.276 ms over 200 calls, against a same-process floor of 0.0005 ms. The
 * socket is 99.6% of that, and a reused connection costs 0.045 ms, so the page's
 * keep-alive connection - which `fetch` gives for free - is why the per-call
 * budget is about 0.05 ms, not 0.12 ms. research/bridge.md §2.
 */

import type { ArgsOf, CommandSchema, ResultOf } from "../plugins/define";

export interface CrustConfig {
	/** Absolute bridge URL in dev (`http://127.0.0.1:54321`); empty for the served page. */
	baseUrl?: string;
	/**
	 * The same address under the name a dev server's injected global uses.
	 * `crust/vite` writes `{ url, token }`, the bridge writes `{ baseUrl, token }`,
	 * and the client reads either so both paths share one implementation.
	 */
	url?: string;
	/** Per-launch token. The only credential the bridge accepts. */
	token: string;
	/** The port the bridge bound, for diagnostics. */
	port?: number;
}

export interface CrustInvokeError extends Error {
	readonly code: string;
	readonly status: number;
	readonly requires?: string;
}

/** The typed form: `invoke(plugin, command, args)` is checked against the schema. */
export interface TypedInvoke<Schema extends CommandSchema> {
	<Plugin extends keyof Schema & string, Command extends keyof Schema[Plugin] & string>(
		plugin: Plugin,
		command: Command,
		args?: ArgsOf<Schema[Plugin][Command]>,
	): Promise<ResultOf<Schema[Plugin][Command]>>;
}

/** The escape hatch: a plugin or command the schema does not know about. */
export interface LooseInvoke {
	<T = unknown>(plugin: string, command: string, args?: unknown): Promise<T>;
}

export interface CrustApi<Schema extends CommandSchema = CommandSchema> {
	readonly baseUrl: string;
	readonly token: string;
	/** Resolves after the first handshake: the SSE stream opened, or an invoke answered. */
	readonly ready: Promise<void>;
	invoke: TypedInvoke<Schema> & LooseInvoke;
	/** Subscribe to a pushed event. Returns the unsubscribe function. */
	listen<T = unknown>(event: string, fn: (payload: T) => void): () => void;
	/** Resolve with the next payload of that event. */
	once<T = unknown>(event: string): Promise<T>;
}

/** What `installCrust` reads and writes. `window` in a page, a stub in a test. */
export interface CrustTarget {
	fetch?: typeof fetch;
	EventSource?: unknown;
	crust?: unknown;
	__CRUST__?: CrustConfig;
}

/**
 * Install `window.crust`. Everything it needs is inside this function, because
 * the served bootstrap is `installCrust.toString()`: a reference to module scope
 * would arrive in the page undefined. Keep it that way.
 *
 * Called with a config, it uses that. Called with none — which is what
 * `crust/vite` injects — it installs from a pre-set `window.__CRUST__`, so a
 * page whose document came from a dev server runs the same client as one the
 * bridge served.
 */
export function installCrust<Schema extends CommandSchema = CommandSchema>(
	config?: CrustConfig,
	target: CrustTarget = globalThis as unknown as CrustTarget,
): CrustApi<Schema> {
	const scope = target as unknown as Record<string, any>;
	// A page that already has a client keeps it: a second install would open a
	// second event stream and leave the first one's listeners orphaned.
	if (scope.crust) return scope.crust as CrustApi<Schema>;
	const resolved = config ?? scope.__CRUST__;
	if (!resolved || typeof resolved.token !== "string") {
		throw new Error("crust: no bridge config — window.__CRUST__ was never injected");
	}
	const base = (resolved.url ?? resolved.baseUrl ?? "").replace(/\/+$/, "");
	const token = resolved.token;
	const listeners = new Map<string, Set<(payload: unknown) => void>>();
	const waiters = new Map<string, Array<(payload: unknown) => void>>();
	const attached = new Set<string>();
	let stream: any = null;
	let handshaken = false;
	let resolveReady: (() => void) | undefined;
	const ready = new Promise<void>((resolve) => {
		resolveReady = resolve;
	});

	const markHandshake = () => {
		if (handshaken) return;
		handshaken = true;
		if (resolveReady) resolveReady();
	};

	const decode = (raw: unknown): unknown => {
		if (typeof raw !== "string") return raw;
		try {
			return JSON.parse(raw);
		} catch {
			return raw;
		}
	};

	const dispatch = (event: string, payload: unknown) => {
		const set = listeners.get(event);
		if (set) {
			for (const fn of Array.from(set)) {
				try {
					fn(payload);
				} catch (error) {
					// A page listener must never break the stream for every other listener.
					if (typeof console !== "undefined")
						console.error(`crust: listener for "${event}" threw`, error);
				}
			}
		}
		const pending = waiters.get(event);
		if (pending) {
			waiters.delete(event);
			for (const fn of pending) fn(payload);
		}
	};

	const attach = (event: string) => {
		if (!stream || attached.has(event)) return;
		attached.add(event);
		stream.addEventListener(event, (message: any) => dispatch(event, decode(message?.data)));
	};

	const listen = <T = unknown>(event: string, fn: (payload: T) => void): (() => void) => {
		let set = listeners.get(event);
		if (!set) {
			set = new Set();
			listeners.set(event, set);
		}
		set.add(fn as (payload: unknown) => void);
		attach(event);
		return () => {
			set?.delete(fn as (payload: unknown) => void);
			if (set && set.size === 0) listeners.delete(event);
		};
	};

	const once = <T = unknown>(event: string): Promise<T> =>
		new Promise<T>((resolve) => {
			let pending = waiters.get(event);
			if (!pending) {
				pending = [];
				waiters.set(event, pending);
			}
			pending.push(resolve as (payload: unknown) => void);
			attach(event);
		});

	class InvokeFailure extends Error implements CrustInvokeError {
		readonly code: string;
		readonly status: number;
		readonly requires?: string;

		constructor(code: string, message: string, status: number, requires?: string) {
			super(message);
			this.name = "CrustInvokeError";
			this.code = code;
			this.status = status;
			if (requires !== undefined) this.requires = requires;
		}
	}

	const call = async (plugin: string, command: string, args?: unknown): Promise<unknown> => {
		const fetchImpl = scope.fetch ?? (globalThis as any).fetch;
		if (typeof fetchImpl !== "function") {
			throw new InvokeFailure("no-fetch", "this page has no fetch()", 0);
		}
		const response = await fetchImpl.call(scope, `${base}/_crust/invoke`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ plugin, command, args: args === undefined ? null : args }),
		});
		const text = await response.text();
		let body: any;
		try {
			body = JSON.parse(text);
		} catch {
			throw new InvokeFailure(
				"bad-response",
				`bridge returned non-json (${response.status}): ${String(text).slice(0, 200)}`,
				response.status,
			);
		}
		if (!body || body.ok !== true) {
			const error = body?.error ?? {};
			throw new InvokeFailure(
				typeof error.code === "string" ? error.code : "handler-error",
				typeof error.message === "string" ? error.message : "invoke failed",
				response.status,
				typeof error.requires === "string" ? error.requires : undefined,
			);
		}
		markHandshake();
		return body.result;
	};

	// Two call forms on one entry point, and the same code on every serving
	// path. `invoke(plugin, command, args)` is the plugin form; a second
	// argument that is not a string is the app form, `invoke(name, args)`, which
	// routes through the always-registered `app` namespace. The name is written
	// here rather than imported because this function's own source text is the
	// page's copy of it.
	const APP = "app";
	const invoke = (name: string, command?: unknown, args?: unknown): Promise<unknown> => {
		if (typeof command === "string") return call(name, command, args);
		return call(APP, "invoke", { name: name, args: command === undefined ? {} : command });
	};

	const connect = () => {
		const EventSourceImpl = scope.EventSource ?? (globalThis as any).EventSource;
		if (typeof EventSourceImpl !== "function") return;
		let source: any;
		try {
			// EventSource cannot set headers, so the token goes in the query string.
			source = new EventSourceImpl(
				`${base}/_crust/events?token=${encodeURIComponent(token)}`,
			);
		} catch {
			return;
		}
		stream = source;
		attached.add("crust:ready");
		source.addEventListener("crust:ready", (message: any) => {
			markHandshake();
			dispatch("crust:ready", decode(message?.data));
		});
		for (const event of listeners.keys()) attach(event);
		for (const event of waiters.keys()) attach(event);
		// EventSource reconnects by itself. `ready` stays pending until a frame
		// arrives, which is the honest signal: the stream is not open until it is.
		source.onerror = () => {};
	};

	const api = {
		baseUrl: base,
		token,
		ready,
		invoke: invoke as TypedInvoke<Schema> & LooseInvoke,
		listen,
		once,
	};
	scope.crust = api;
	scope.__CRUST__ = resolved;
	connect();
	return api as CrustApi<Schema>;
}

/**
 * The source the served document carries.
 *
 * `installCrust.toString()` is not pretty, but it is the same function the
 * server's tests exercise, so the page cannot drift from the tested client.
 */
export function bootstrapSource(config: CrustConfig): string {
	return `(${installCrust.toString()})(${JSON.stringify(config)}, window);`;
}

/**
 * The client alone, for a page the bridge did not serve.
 *
 * `crust/vite` injects `window.__CRUST__` and then this, so a dev-server
 * document installs the same client with no second copy of the invoke path.
 */
export function pageClientSource(): string {
	return `(${installCrust.toString()})();`;
}
