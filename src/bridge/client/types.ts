/**
 * The shapes the page-side client exposes. They live apart from `install.ts` because `installCrust` is serialised with `Function.prototype.toString()` and must stay self-contained: only type declarations may live outside it, since types are erased before the page sees the source.
 */

import type { ArgsOf, CommandSchema, ResultOf } from "../../plugins/define";
import type { PageA11y } from "./a11y-page-types.ts";

export type { CommandSchema } from "../../plugins/define";

/**
 * The typed-IPC map, re-declared here because a page imports its client types from this module and
 * nothing on that side may reach a runtime module. `bridge/typed.ts` owns the wrappers; the shapes
 * are only types, so they are erased before the page ever sees the injected source.
 */
export type { InvokeMap, TypedClient, TypedClientSource } from "../typed.ts";

export interface CrustConfig {
	/** Absolute bridge URL in dev (`http://127.0.0.1:54321`); empty for the served page. */
	baseUrl?: string;
	/**
	 * The same address under the name a dev server's injected global uses.
	 * `crust/vite` writes `{ url, token }`, the bridge writes `{ baseUrl }` and leaves `token` out —
	 * a served page reads its own token out of `location.search`, so the document it was handed
	 * never contains the credential.
	 */
	url?: string;
	/**
	 * Per-launch token. The only credential the bridge accepts. Absent from a bridge-served
	 * document's injected config by design: `bootstrap.ts` reads it from the page's own URL.
	 */
	token?: string;
	/** The port the bridge bound, for diagnostics. */
	port?: number;
	/**
	 * Which window this page is, sent with every invoke so `window.label` can answer it. The
	 * bridge writes the label it read from the document request; a dev-server page falls back to
	 * its own `location.search`. A routing hint, never authority — see `bridge/window-identity.ts`.
	 */
	window?: string;
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
	readonly token?: string;
	/**
	 * Resolves after the first exchange that proves the bridge answered: the SSE stream opened, an
	 * invoke with a 2xx, or an `ok:true` envelope carrying a typed command failure. A typed failure
	 * resolves as a value with a 4xx/5xx transport and does not reject `ready`. Rejects with a
	 * `CrustInvokeError` (`code: "bridge-refused"`) only for a refusal body with a 4xx — a stale
	 * token, a bad origin, or no bridge route. A transport failure with status 0 leaves it pending.
	 */
	readonly ready: Promise<void>;
	invoke: TypedInvoke<Schema> & LooseInvoke;
	/**
	 * The page's own DOM view: `pageTree(selector?)` and `focusElement(selector)`. Page-local — no
	 * bridge call, no native half — and a report of the DOM, not of the OS accessibility tree.
	 * Absent only for a hand-built install that did not pass the factory.
	 */
	a11y?: PageA11y;
	/** Subscribe to a pushed event. Returns the unsubscribe function. */
	listen<T = unknown>(event: string, fn: (payload: T) => void): () => void;
	/**
	 * Resolve with the next payload of that event, with a named `once-timeout` rejection after
	 * `timeoutMs` (default 30s) if no emitter answers. The waiter is removed on either path.
	 */
	once<T = unknown>(event: string, timeoutMs?: number): Promise<T>;
}

/** What `installCrust` reads and writes. `window` in a page, a stub in a test. */
export interface CrustTarget {
	fetch?: typeof fetch;
	EventSource?: unknown;
	crust?: unknown;
	__CRUST__?: CrustConfig;
	/** The page's own URL, which a dev-server page reads its window label from. */
	location?: { search?: string };
}
