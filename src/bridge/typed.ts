/**
 * Typed IPC: one `InvokeMap` both halves import, so a host handler and the page that calls it agree
 * on the command names and the argument/result shapes at *compile* time instead of discovering a
 * typo as a runtime `unknown-command`.
 *
 * Both wrappers are thin, and deliberately so: the host side is `app.command` and the page side is
 * `window.crust.invoke`, so nothing new reaches the wire — no new protocol, no new payload shape,
 * no second registration path. What the map buys is that `typedClient<M>()` refuses a name it has
 * never heard of and an `input` that does not match, and hands the caller `output` back.
 *
 * The map itself is the app's declaration; this module never invents keys for it.
 */

import type { CommandHandler, MaybePromise, PluginContext } from "../plugins/define";

/**
 * The wire contract. One entry per command, keyed by the name the page passes to `invoke` — the
 * same string `app.command(name, …)` registers.
 *
 * A plugin's commands are addressed the same way as an app command, so an app that only uses
 * plugins can still write the map by hand with `"fs.readTextFile"` style keys if that is how it
 * exposes them; nothing here inspects the name.
 */
export interface InvokeMap {
	[command: string]: { input: unknown; output: unknown };
}

/**
 * The one method a typed host wrapper needs from the app it wraps. Left loose on purpose: the
 * wrapper narrows the handler at its own call site, so pinning the parameter type here would only
 * re-check `App.command`'s signature in the wrong direction (a handler with no `ctx` would be
 * rejected by the *target*, not by the map).
 */
export interface CommandHost {
	command(name: string, handler: (...args: any[]) => any): unknown;
}

/** What the page-side wrapper needs: the client's own `invoke`, however it is implemented. */
export interface TypedClientSource {
	invoke(...args: any[]): Promise<any>;
}

export interface TypedHost<M extends InvokeMap> {
	/**
	 * Register the handler behind one command name. The name and both shapes come from `M`, so a
	 * typo or a wrong return type is a type error at the registration site.
	 *
	 * `ctx` is the bridge's `PluginContext` when the call arrives over HTTP; `app.invoke` (the
	 * two-argument page form) calls the handler with its arguments alone, so `ctx` is `undefined`
	 * on that path — the same behaviour `app.command` has always had.
	 */
	command<K extends keyof M & string>(
		name: K,
		handler: (input: M[K]["input"], ctx: PluginContext) => MaybePromise<M[K]["output"]>,
	): TypedHost<M>;
}

export interface TypedClient<M extends InvokeMap> {
	/** Call one command. A name not in `M`, or an `input` that does not match, does not compile. */
	invoke<K extends keyof M & string>(name: K, input: M[K]["input"]): Promise<M[K]["output"]>;
}

/**
 * Wrap the app so every `command()` call is checked against `M`. The wrapper registers through
 * `app.command` unchanged, so `run()` ordering, duplicate-name refusal and the "after run()" guard
 * all still apply — this is a type surface, not a second registry.
 */
export function typedHost<M extends InvokeMap>(app: CommandHost): TypedHost<M> {
	const wrap: TypedHost<M> = {
		command(name, handler) {
			app.command(name, handler as unknown as CommandHandler);
			return wrap;
		},
	};
	return wrap;
}

/**
 * Wrap the page client so `invoke()` is checked against the same `M`. It calls the client's own
 * two-argument app form — `invoke(name, args)` — which routes to `app.invoke`, so a handler
 * registered with `typedHost` answers it.
 */
export function typedClient<M extends InvokeMap>(bridge: TypedClientSource): TypedClient<M> {
	return {
		invoke(name, input) {
			return bridge.invoke(name, input) as Promise<M[typeof name]["output"]>;
		},
	};
}
