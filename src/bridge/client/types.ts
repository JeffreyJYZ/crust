/**
 * The shapes the page-side client exposes. They live apart from `install.ts` because `installCrust` is serialised with `Function.prototype.toString()` and must stay self-contained: only type declarations may live outside it, since types are erased before the page sees the source.
 */

import type { ArgsOf, CommandSchema, ResultOf } from "../../plugins/define";

export type { CommandSchema } from "../../plugins/define";

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
