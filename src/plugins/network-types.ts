/**
 * The shapes `crust:network` speaks, kept apart from the command wiring so the page-side client can
 * be typed from one module and the plugin's own file stays about behaviour.
 */

import type { NotImplemented, PluginContext } from "./define.ts";

/** The scheme the handler is registered for. A page must request this scheme to be intercepted. */
export const NETWORK_SCHEME = "crust-net";

/** How many entries `log()` keeps; the oldest are dropped first. */
export const NETWORK_LOG_LIMIT = 100;

/**
 * The longest URL a rule is matched against. The native handler copies the URL into a 2048-byte
 * buffer (`src/platform/darwin/shim/110_network.c`, `NET_TEXT`) and truncates at 2047 bytes, so a
 * longer URL reaches the matcher as a prefix — and a prefix match lets a tail-anchored `block` rule
 * be dodged with a long query string. Such a URL is answered `block` instead of matched.
 */
export const NETWORK_URL_LIMIT = 2047;

/** A pattern longer than any URL it could match, or with more stars than this, is refused by name. */
export const NETWORK_PATTERN_LIMIT = 2048;
export const NETWORK_WILDCARD_LIMIT = 32;

export type NetworkAction = "allow" | "block";
/** `served` means the handler fetched and delivered the body; `blocked` means a real error. */
export type NetworkStatus = "served" | "blocked";

export interface NetworkRule {
	/** A URL, or a URL with `*` standing for any run of characters. */
	pattern: string;
	action: NetworkAction;
}

export interface NetworkLogEntry {
	url: string;
	action: NetworkAction;
	status: NetworkStatus;
	/** Why a request was answered without matching the rules; absent when a rule decided. */
	reason?: string;
}

/** What a refused registration reports; `ok` is what `rules()` carries as `registered`. */
export interface NetworkInstall {
	ok: boolean;
	reason: string;
}

/** The native half of `crust:network`; `createNetworkPlugin` takes it structurally. */
export interface NetworkAdapter {
	/**
	 * Register the handler on a configuration no webview has used yet, so every request the page
	 * makes under `scheme` reaches `decide`.
	 */
	install(scheme: string, decide: (url: string) => NetworkAction): NetworkInstall;
}

/** What a command answers when the scheme handler landed, or did not. */
export interface NetworkState {
	ok: true;
	scheme: string;
	rules: NetworkRule[];
	registered: boolean;
	reason: string;
}

/** The command map, so `plugin.commands.rules` is a function and not `| undefined`. */
export type NetworkCommands = {
	rules: (args: unknown, ctx: PluginContext) => Promise<NetworkState | NotImplemented>;
	setRules: (
		args: { rules?: unknown },
		ctx: PluginContext,
	) => Promise<NetworkState | NotImplemented>;
	log: (
		args: unknown,
		ctx: PluginContext,
	) => Promise<{ ok: true; entries: NetworkLogEntry[] } | NotImplemented>;
	clearLog: (
		args: unknown,
		ctx: PluginContext,
	) => Promise<{ ok: true; cleared: number } | NotImplemented>;
};
