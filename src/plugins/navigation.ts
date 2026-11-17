/**
 * `crust:navigation` — what a page can ask about its own webview, and what that webview reports back. `WKNavigationDelegate` is WebKit's, so this module owns no framework: macOS supplies `darwinNavigationAdapter()` and a platform with no WKWebView keeps answering a typed `NotImplemented`.
 * Two things stay separate. A command answers the state at the moment it ran, and every delegate callback is an event — `navigation:did-start`, `:did-commit`, `:did-finish`, `:did-fail` — because a load that began is not a load that finished, and a page that only polled `state()` would miss both.
 * Every command takes an optional `{ label }`, read before the adapter runs and passed to it last, so a page can aim one window and a caller that passes nothing keeps meaning the app's first open window. A label naming no open window is `bad-request` naming it — the resolver's refusal is passed through, never flattened into `handler-error`, because it is the one failure the caller can fix.
 * Nothing else here throws: a refused send is a typed failure object, and an adapter that threw becomes `handler-error` rather than a rejected invoke.
 */

import {
	definePlugin,
	notImplemented,
	type NotImplemented,
	type PluginContext,
	type PluginDefinition,
} from "./define";
import { loadUrlCommand } from "./navigation-load";
import { failure, target } from "./navigation-target";
import type {
	NavigationAdapter,
	NavigationArgs,
	NavigationFailure,
	NavigationLoadUrlArgs,
	NavigationState,
} from "./navigation-types";

export type {
	NavigationAdapter,
	NavigationArgs,
	NavigationEventKind,
	NavigationEventPayload,
	NavigationFailure,
	NavigationInstall,
	NavigationLoadUrlArgs,
	NavigationState,
} from "./navigation-types";

export function createNavigationPlugin(adapter?: NavigationAdapter): PluginDefinition<
	"navigation",
	{
		start: (
			args: NavigationArgs | undefined,
			ctx: PluginContext,
		) => NavigationFailure | NotImplemented | { ok: true; status: number; reason: string };
		stop: (
			args: NavigationArgs | undefined,
			ctx: PluginContext,
		) => { ok: true; stopped: boolean } | NavigationFailure | NotImplemented;
		state: (
			args: NavigationArgs | undefined,
			ctx: PluginContext,
		) => (NavigationState & { ok: true }) | NavigationFailure | NotImplemented;
		reload: (
			args: NavigationArgs | undefined,
			ctx: PluginContext,
		) => { ok: true; reloaded: boolean } | NavigationFailure | NotImplemented;
		goBack: (
			args: NavigationArgs | undefined,
			ctx: PluginContext,
		) => { ok: true; moved: boolean } | NavigationFailure | NotImplemented;
		goForward: (
			args: NavigationArgs | undefined,
			ctx: PluginContext,
		) => { ok: true; moved: boolean } | NavigationFailure | NotImplemented;
		loadUrl: (
			args: NavigationLoadUrlArgs,
			ctx: PluginContext,
		) => { ok: true; loaded: boolean } | NavigationFailure | NotImplemented;
	}
> {
	const native = adapter;
	const missing = (command: string) =>
		notImplemented(
			`navigation.${command} needs WKNavigationDelegate, which only WebKit provides. Pass a NavigationAdapter to createNavigationPlugin on a platform that has no WKWebView.`,
			"WKNavigationDelegate",
		);

	// A callback fires outside any command, and `emit` only exists for the length of one, so the
	// most recent context is the channel it has. The delegate cannot exist before `start` ran,
	// which is what makes that channel already set.
	let sink: PluginContext["emit"] | undefined;

	/**
	 * The one path every command takes: refuse without an adapter, read the window, then run.
	 * The label is validated here, so a malformed one never reaches a native call and an
	 * unknown one is answered by the resolver rather than by that call.
	 */
	const run = <Result>(
		command: string,
		args: unknown,
		call: (adapter: NavigationAdapter, label?: string) => Result,
	): Result | NavigationFailure | NotImplemented => {
		if (!native) return missing(command);
		const chosen = target(args);
		if ("ok" in chosen) return chosen;
		try {
			return call(native, chosen.label);
		} catch (error) {
			return failure(error);
		}
	};

	return definePlugin({
		name: "navigation",
		commands: {
			/** Install the delegate on one window. Every later callback reaches this page as an event. */
			start: (args: NavigationArgs | undefined, ctx: PluginContext) => {
				sink = ctx.emit;
				return run("start", args, (web, label) => {
					const installed = web.start((kind, payload) => {
						try {
							sink?.(`navigation:${kind}`, payload);
						} catch {
							// A page handler that throws must not unwind into AppKit's delegate call.
						}
					}, label);
					if (!installed.ok) {
						return {
							ok: false as const,
							code: "handler-error" as const,
							message: installed.reason,
						};
					}
					return { ok: true, status: installed.status, reason: installed.reason };
				});
			},
			/** Remove the delegate; the webview keeps loading, it just stops reporting. */
			stop: (args: NavigationArgs | undefined, ctx: PluginContext) => {
				sink = ctx.emit;
				return run("stop", args, (web, label) => {
					try {
						web.stop(label);
						return { ok: true as const, stopped: true as const };
					} catch (error) {
						// An unknown label is the resolver's refusal, which the caller can fix;
						// any other throw still means the delegate is gone either way, which is
						// what `stop` promised.
						const refused = failure(error);
						if (refused.code === "bad-request") return refused;
						return { ok: true as const, stopped: false as const };
					}
				});
			},
			/** The address, title and history flags at this moment. */
			state: (args: NavigationArgs | undefined, ctx: PluginContext) => {
				sink = ctx.emit;
				return run("state", args, (web, label) => {
					const state = web.state(label);
					if (state === null) {
						return {
							ok: false as const,
							code: "handler-error" as const,
							message:
								"navigation.state: there is no WKWebView yet; call start() after the window exists",
						};
					}
					return { ok: true as const, ...state };
				});
			},
			/** Reload the page in place. `reloaded: false` means nothing was sent. */
			reload: (args: NavigationArgs | undefined, ctx: PluginContext) => {
				sink = ctx.emit;
				return run("reload", args, (web, label) => ({
					ok: true as const,
					reloaded: web.reload(label),
				}));
			},
			/** One entry back. `moved: false` is an empty history, not a failure. */
			goBack: (args: NavigationArgs | undefined, ctx: PluginContext) => {
				sink = ctx.emit;
				return run("goBack", args, (web, label) => ({
					ok: true as const,
					moved: web.goBack(label),
				}));
			},
			/** One entry forward. `moved: false` is an empty history, not a failure. */
			goForward: (args: NavigationArgs | undefined, ctx: PluginContext) => {
				sink = ctx.emit;
				return run("goForward", args, (web, label) => ({
					ok: true as const,
					moved: web.goForward(label),
				}));
			},
			/** Point one window's webview at `url`. `loaded: false` means no webview was there. */
			loadUrl: (args: NavigationLoadUrlArgs, ctx: PluginContext) =>
				loadUrlCommand(
					{
						adapter: native,
						missing,
						setSink: (emit) => {
							sink = emit;
						},
					},
					args,
					ctx,
				),
		},
	});
}

/** The default registration: honest about the missing framework. */
export const navigationPlugin = createNavigationPlugin();
