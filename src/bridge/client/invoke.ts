/**
 * The page's transport half: one POST, one error shape, and how a result's bytes come back. Split out
 * of `install.ts` because `installCrust` is serialised whole with `Function.prototype.toString()`
 * and had reached the file cap; both halves are composed at inject time by `bootstrap.ts`, so —
 * exactly like `installCrust` — this function may reference nothing from module scope.
 */

import type { DocumentLike, InvokeHalf } from "./invoke-half.ts";
import type * as T from "./types";

export type { DocumentLike, InvokeHalf } from "./invoke-half.ts";

/**
 * Build the page's `call(plugin, command, args)`. `label` is the window identity the page was
 * opened with; it rides on every request as a hint the bridge hands to `window.label`, never as
 * authority — the bearer token is the only credential, so a wrong label can only mislabel the
 * caller.
 *
 * When `scope.crustInvoke` exists, a darwin window installed a content-world bridge: the token lives
 * in a JavaScript world this one cannot read or patch, so this half never touches a credential and
 * only awaits that function. Everywhere else — a Vite dev page, Linux, Windows — it is absent and
 * the fetch path below runs unchanged.
 */
export function installInvoke(
	scope: Record<string, any>,
	base: string,
	token: string | undefined,
	label: string | undefined,
	onAnswer: () => void,
	onEvent: (event: string, payload: unknown) => void,
): InvokeHalf {
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
	const realmCall = scope.crustInvoke;
	const hasRealm = typeof realmCall === "function";
	const doc = scope.document as DocumentLike | undefined;
	const asked: Record<string, boolean> = Object.create(null);
	let stream: any = null;
	let relayed = false;

	// A binary result arrives tagged `{ __crustBytes: base64 }`, revived one level deep; a data
	// object that carried a tag key arrives as `{ __crustLiteral: … }` and is handed back whole.
	// `Object.defineProperty` for every key, because one literally named `__proto__` would
	// otherwise set the prototype instead of surviving as a field.
	const put = (out: any, key: string, value: any) => {
		Object.defineProperty(out, key, {
			value,
			enumerable: true,
			writable: true,
			configurable: true,
		});
	};

	const revive = (value: any, depth: number): any => {
		if (depth > 1 || value === null || typeof value !== "object") return value;
		if (
			typeof value.__crustLiteral === "object" &&
			value.__crustLiteral !== null &&
			!Array.isArray(value.__crustLiteral)
		) {
			// Real data that merely carried a tag key. Walk its *values* one level down, so the
			// object itself is never read as a tag while a genuine binary inside it still revives.
			const literal = value.__crustLiteral;
			const out: any = {};
			for (const key of Object.keys(literal)) put(out, key, revive(literal[key], depth + 1));
			return out;
		}
		if (typeof value.__crustBytes === "string") {
			return Uint8Array.from(atob(value.__crustBytes), (char) => char.charCodeAt(0));
		}
		const out: any = Array.isArray(value) ? [] : {};
		for (const key of Object.keys(value)) put(out, key, revive(value[key], depth + 1));
		return out;
	};

	/** Rebuild the error an envelope names, so both transports throw the same class. */
	const fail = (error: any, status: number): InvokeFailure =>
		new InvokeFailure(
			typeof error?.code === "string" ? error.code : "handler-error",
			typeof error?.message === "string" ? error.message : "invoke failed",
			typeof error?.status === "number" ? error.status : status,
			typeof error?.requires === "string" ? error.requires : undefined,
		);

	// The content world owns the stream and the token, so this world only names the events it
	// wants; the frames come back as DOM events and go to the same handler either way. The listener
	// is installed once, on first ask, because two relays would double every frame.
	const askWorld = () => {
		const emit = doc?.dispatchEvent;
		if (typeof emit !== "function" || typeof scope.CustomEvent !== "function") return;
		if (!relayed) {
			relayed = true;
			doc?.addEventListener?.("crust:evt", (message: any) => {
				let frame: any;
				try {
					frame = JSON.parse(message?.detail);
				} catch {
					return;
				}
				if (typeof frame?.event !== "string") return;
				if (frame.event === "crust:ready") onAnswer();
				onEvent(frame.event, frame.data);
			});
		}
		emit.call(doc, new scope.CustomEvent("crust:sub", { detail: JSON.stringify(asked) }));
	};

	const half = (async (plugin: string, command: string, args?: unknown) => {
		if (hasRealm) {
			const reply = await realmCall(plugin, command, args === undefined ? null : args);
			onAnswer();
			if (reply && reply.ok === true) return revive(reply.result, 0);
			throw fail(reply?.error, 0);
		}
		const fetchImpl = scope.fetch ?? (globalThis as any).fetch;
		if (typeof fetchImpl !== "function") {
			throw new InvokeFailure("no-fetch", "this page has no fetch()", 0);
		}
		const response = await fetchImpl.call(scope, `${base}/_crust/invoke`, {
			method: "POST",
			headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
			body: JSON.stringify({
				plugin,
				command,
				args: args === undefined ? null : args,
				window: label ?? null,
			}),
		});
		// A completed HTTP response is a handshake even when it is an error: the page has learned
		// the bridge is reachable, and a `ready` that never settles on a stale token or an unmounted
		// plugin is a hang the page cannot recover from. A transport throw stays pending — the
		// stream can still open and answer.
		onAnswer();
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
		if (!body || body.ok !== true) throw fail(body?.error, response.status);
		return revive(body.result, 0);
	}) as InvokeHalf;

	half.attach = (event: string) => {
		if (asked[event]) return;
		asked[event] = true;
		if (hasRealm) {
			askWorld();
			return;
		}
		bound(event);
	};

	/** Bind one listener to the live stream; a name asked for before it opened is bound by connect. */
	const bound = (event: string) => {
		if (!stream) return;
		stream.addEventListener(event, (message: any) => onEvent(event, message?.data));
	};

	half.connect = () => {
		// Something must always want the handshake frame, or `ready` never settles.
		half.attach("crust:ready");
		if (hasRealm) return askWorld();
		const EventSourceImpl = scope.EventSource ?? (globalThis as any).EventSource;
		if (typeof EventSourceImpl !== "function") return;
		try {
			// EventSource cannot set headers, so the token goes in the query string.
			stream = new EventSourceImpl(
				`${base}/_crust/events?token=${encodeURIComponent(String(token ?? ""))}`,
			);
		} catch {
			return;
		}
		// EventSource reconnects by itself, and `ready` stays pending until a frame arrives: the
		// stream is not open until it is.
		stream.onerror = () => {};
		for (const event of Object.keys(asked)) bound(event);
	};

	return half;
}
