/**
 * The client body: `installCrust`. Everything it needs is inside the function,
 * because the served bootstrap is `installCrust.toString()` and a module-scope
 * reference would arrive in the page undefined; only types live outside, as
 * `T.`. Called with a config it uses that; called with none (`crust/vite`) it
 * installs from the pre-set `window.__CRUST__`.
 */
import type * as T from "./types";

export function installCrust<Schema extends T.CommandSchema = T.CommandSchema>(
	config?: T.CrustConfig,
	target: T.CrustTarget = globalThis as unknown as T.CrustTarget,
): T.CrustApi<Schema> {
	const scope = target as unknown as Record<string, any>;
	// A page that already has a client keeps it: a second install would open a
	// second event stream and leave the first one's listeners orphaned.
	if (scope.crust) return scope.crust as T.CrustApi<Schema>;
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

	class InvokeFailure extends Error implements T.CrustInvokeError {
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
		invoke: invoke as T.TypedInvoke<Schema> & T.LooseInvoke,
		listen,
		once,
	};
	scope.crust = api;
	scope.__CRUST__ = resolved;
	connect();
	return api as T.CrustApi<Schema>;
}
