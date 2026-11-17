/**
 * The page's invoke half: one POST, one error shape, and how a result's bytes come back. Split out
 * of `install.ts` because `installCrust` is serialised whole with `Function.prototype.toString()`
 * and had reached the file cap; both halves are composed at inject time by `bootstrap.ts`, so —
 * exactly like `installCrust` — this function may reference nothing from module scope.
 */

import type * as T from "./types";

/**
 * Build the page's `call(plugin, command, args)`. `label` is the window identity the page was
 * opened with; it rides on every request as a hint the bridge hands to `window.label`, never as
 * authority — the bearer token is the only credential, so a wrong label can only mislabel the
 * caller.
 */
export function installInvoke(
	scope: Record<string, any>,
	base: string,
	token: string,
	label: string | undefined,
	onAnswer: () => void,
): (plugin: string, command: string, args?: unknown) => Promise<unknown> {
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

	// A binary result arrives tagged `{ __crustBytes: base64 }`, revived one level deep; a data
	// object that carried a tag key arrives as `{ __crustLiteral: … }` and is handed back whole.
	const fromBase64 = (text: string): Uint8Array =>
		Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

	// `Object.defineProperty`, because a key literally named `__proto__` would otherwise set the
	// prototype instead of surviving as a field.
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
		if (typeof value.__crustBytes === "string") return fromBase64(value.__crustBytes);
		const out: any = Array.isArray(value) ? [] : {};
		for (const key of Object.keys(value)) put(out, key, revive(value[key], depth + 1));
		return out;
	};

	return async (plugin, command, args) => {
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
		if (!body || body.ok !== true) {
			const error = body?.error ?? {};
			throw new InvokeFailure(
				typeof error.code === "string" ? error.code : "handler-error",
				typeof error.message === "string" ? error.message : "invoke failed",
				response.status,
				typeof error.requires === "string" ? error.requires : undefined,
			);
		}
		return revive(body.result, 0);
	};
}
