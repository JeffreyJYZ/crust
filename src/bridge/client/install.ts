/**
 * The client body: `installCrust`. Everything it needs is inside the function, because the served bootstrap is `installCrust.toString()` and a module-scope reference would arrive undefined in the page; only types live outside, as `T.`, plus the invoke half which `bootstrap.ts` passes in the same way. Called with a config it uses that; called with none (`crust/vite`) it installs from the pre-set `window.__CRUST__`.
 *
 * The transport — the POST, the event stream and which of the two carries the credential — lives in
 * the invoke half beside this one. The page's own DOM view — `pageTree` and `focusElement` — lives in
 * the a11y half; both are passed in and serialised with this function, so neither may reach module
 * scope. This half owns the page's API surface and nothing else, so a page whose token sits in a
 * JavaScript world it cannot read installs the same client unchanged.
 */
import type * as T from "./types";
import type { installInvoke } from "./invoke.ts";
import type { installPageA11y } from "./a11y-page.ts";
import type { PageA11y } from "./a11y-page-types.ts";

export function installCrust<Schema extends T.CommandSchema = T.CommandSchema>(
	config?: T.CrustConfig,
	target: T.CrustTarget = globalThis as unknown as T.CrustTarget,
	invokeFactory?: typeof installInvoke,
	a11yFactory?: typeof installPageA11y,
): T.CrustApi<Schema> {
	const scope = target as unknown as Record<string, any>;
	// A page that already has a client keeps it: a second install would open a
	// second event stream and leave the first one's listeners orphaned.
	if (scope.crust) return scope.crust as T.CrustApi<Schema>;
	const resolved = config ?? scope.__CRUST__;
	// A darwin window installs a content-world bridge, which owns the token and scrubs it from the
	// page's URL before this runs; everywhere else the token is the page's own and is required.
	const realm = scope.crustInvoke;
	const hasRealm = typeof realm === "function";
	if (!resolved || (!hasRealm && typeof resolved.token !== "string")) {
		throw new Error("crust: no bridge config — window.__CRUST__ was never injected");
	}
	// The other half of the client is composed beside this one, because neither may reach module
	// scope: without it there is no way to call the bridge at all, so say so at install.
	if (typeof invokeFactory !== "function") {
		throw new Error("crust: no invoke half — install the client from the bridge or crust/vite");
	}
	const base = (resolved.url ?? resolved.baseUrl ?? "").replace(/\/+$/, "");
	const token = resolved.token;
	const listeners = new Map<string, Set<(payload: unknown) => void>>();
	const waiters = new Map<string, Array<(payload: unknown) => void>>();
	let handshaken = false;
	let resolveReady: (() => void) | undefined;
	let rejectReady: ((reason?: unknown) => void) | undefined;
	const ready = new Promise<void>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	// A refusal rejects `ready`; a page that never awaits it is not an unhandled rejection.
	void ready.catch(() => {});

	// Only a completed 2xx exchange is readiness. A 4xx is the bridge refusing this page — a stale
	// token, a bad origin, no route — and rejects with its status and reason, so the page can tell a
	// refusal from "no bridge". A 5xx is a handler that threw; the bridge is reachable, so it counts.
	const markHandshake = (status: number, reason?: string) => {
		if (handshaken) return;
		handshaken = true;
		if (status < 400 || status >= 500) {
			resolveReady?.();
			return;
		}
		const error = new Error(
			`crust: bridge refused (${status})${reason ? `: ${reason}` : ""}`,
		) as Error & { name: string; code: string; status: number };
		error.name = "CrustInvokeError";
		error.code = "bridge-refused";
		error.status = status;
		rejectReady?.(error);
	};

	// A frame's `data` is JSON on the wire and a string in a `CustomEvent`, so both transports hand
	// this half text and it is parsed once, here.
	const decode = (raw: unknown): unknown => {
		if (typeof raw !== "string") return raw;
		try {
			return JSON.parse(raw);
		} catch {
			return raw;
		}
	};

	const dispatch = (event: string, payload: unknown) => {
		// Drain before listeners run: a listener that re-arms `once(event)` must not have its fresh
		// waiter settled by the very event that triggered it.
		const pending = waiters.get(event);
		if (pending) {
			waiters.delete(event);
			for (const fn of pending) fn(payload);
		}
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
	};

	// `resolved.window` is the identity the bridge observed on the document request, or the page's
	// own URL when a dev server served it; the invoke half sends it with every call.
	const call = invokeFactory(
		scope,
		base,
		token,
		resolved.window,
		markHandshake,
		(event: string, payload: unknown) => {
			if (event === "crust:ready") markHandshake(200);
			dispatch(event, decode(payload));
		},
	);

	// The page's own DOM view. Absent only for a hand-built install that did not pass the factory;
	// the bridge's two injected sources always pass it, so a real page always has `crust.a11y`.
	const a11y: PageA11y | undefined =
		typeof a11yFactory === "function" ? a11yFactory(scope) : undefined;

	const listen = <T = unknown>(event: string, fn: (payload: T) => void): (() => void) => {
		const set = listeners.get(event) ?? new Set<(payload: unknown) => void>();
		listeners.set(event, set);
		const handler = fn as (payload: unknown) => void;
		set.add(handler);
		call.attach(event);
		return () => {
			set.delete(handler);
			if (set.size === 0) listeners.delete(event);
		};
	};

	// A waiter is one entry in `waiters`; it goes away when the event arrives or when its timer
	// fires. Without the timer an event with no emitter retains its resolver for the page's life.
	const ONCE_TIMEOUT = 30000;
	const once = <T = unknown>(event: string, timeoutMs = ONCE_TIMEOUT): Promise<T> =>
		new Promise<T>((resolve, reject) => {
			const pending = waiters.get(event) ?? [];
			if (!waiters.has(event)) waiters.set(event, pending);
			let timer: ReturnType<typeof setTimeout> | undefined;
			const settle = (payload: unknown) => {
				if (timer !== undefined) clearTimeout(timer);
				resolve(payload as T);
			};
			pending.push(settle);
			call.attach(event);
			timer = setTimeout(() => {
				const at = pending.indexOf(settle);
				if (at >= 0) pending.splice(at, 1);
				if (pending.length === 0) waiters.delete(event);
				const error = new Error(
					`crust: timed out after ${timeoutMs}ms waiting for "${event}"`,
				) as Error & { code: string; event: string; timeoutMs: number };
				error.code = "once-timeout";
				error.event = event;
				error.timeoutMs = timeoutMs;
				reject(error);
			}, timeoutMs);
		});

	// Two call forms on one entry point, and the same code on every serving
	// path: `invoke(plugin, command, args)` is the plugin form, and a second
	// argument that is not a string is the app form, `invoke(name, args)`, which
	// routes through the always-registered `app` namespace. Both names are
	// written here because this function's own source text is the page's copy.
	const APP = "app";
	const invoke = (name: string, command?: unknown, args?: unknown): Promise<unknown> => {
		if (typeof command === "string") return call(name, command, args);
		return call(APP, "invoke", { name: name, args: command === undefined ? {} : command });
	};

	// Plain-HTML dev has no bundler: the bridge emits `dev:reload` when public/ changes.
	// One listener, installed through the client the page already has. A dev-server page
	// and a built app never see the event, so nothing fights Vite's HMR or reloads a
	// shipped window. `scope.location` is read at dispatch time, never from module scope,
	// because this function's own source is the page's copy.
	listen("dev:reload", () => {
		const page = scope.location as { reload?: () => void } | undefined;
		page?.reload?.();
	});

	const api = {
		baseUrl: base,
		// The content-world path keeps the credential in a world the page cannot read, so it must
		// not hand it back here as well: `window.crust.token` is exactly the scrape this closes.
		...(hasRealm ? {} : { token }),
		ready,
		invoke: invoke as T.TypedInvoke<Schema> & T.LooseInvoke,
		...(a11y ? { a11y } : {}),
		listen,
		once,
	};
	scope.crust = api;
	// The token is not handed back to this world on the content-world path — not on the client,
	// and not on `window.__CRUST__` either, which is the other place a scrape would look.
	scope.__CRUST__ = hasRealm ? { ...resolved, token: undefined } : resolved;
	call.connect();
	return api as T.CrustApi<Schema>;
}
