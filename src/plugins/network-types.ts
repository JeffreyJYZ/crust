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
 * The most bytes the native handler can hold for a URL, and the bound a rule is matched under.
 * `net_copy` (`src/platform/darwin/shim/110_network.c`, `NET_TEXT` 2048) keeps at most 2047 bytes
 * and the NUL, so a longer URL reaches the matcher as a prefix — and a prefix match lets a
 * tail-anchored `block` rule be dodged with a long query string.
 * A URL at or beyond this bound is answered `block` instead of matched. That is fail-closed by one
 * byte: a URL of exactly 2047 bytes does fit, and is still refused, because the handler cannot tell
 * a full URL that size from the prefix of a longer one. The darwin adapter reads all 2047 bytes
 * (`URL_CHUNK` in `platform/darwin/network.ts`), so the check sees every byte the handler has.
 */
export const NETWORK_URL_LIMIT = 2047;

/** A pattern longer than any URL it could match, or with more stars than this, is refused by name. */
export const NETWORK_PATTERN_LIMIT = 2048;
export const NETWORK_WILDCARD_LIMIT = 32;

/**
 * The most bytes an `allow` rule may serve. The native side holds one `net_body[NET_BODY]` buffer
 * (`shim/113_network_serve.c`), and a body over it is refused rather than truncated, so a page
 * never reads a silently cut response.
 */
export const NETWORK_BODY_LIMIT = 262144;

/** The content type an `allow` rule serves when it names none. */
export const NETWORK_DEFAULT_TYPE = "text/plain; charset=utf-8";

/** A content type longer than this is refused: the native buffer is 128 bytes including its NUL. */
export const NETWORK_TYPE_LIMIT = 127;

export type NetworkAction = "allow" | "block";
/** `served` means the handler answered with bytes; `blocked` means a real `NSURLError`. */
export type NetworkStatus = "served" | "blocked";

export interface NetworkRule {
	/** A URL, or a URL with `*` standing for any run of characters. */
	pattern: string;
	action: NetworkAction;
	/** The bytes an `allow` rule answers with; absent means an empty body, never a fetch. */
	body?: string;
	/** The `Content-Type` an `allow` rule answers with; absent means `NETWORK_DEFAULT_TYPE`. */
	type?: string;
}

/** What the native handler must do with one task: fail it, or answer it with these bytes. */
export interface NetworkDecision {
	action: NetworkAction;
	body?: string;
	type?: string;
}

export interface NetworkLogEntry {
	url: string;
	action: NetworkAction;
	status: NetworkStatus;
	/** How many bytes the handler delivered; present only on a served request. */
	bytes?: number;
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
	 * makes under `scheme` reaches `decide` and is answered from its decision.
	 */
	install(scheme: string, decide: (url: string) => NetworkDecision): NetworkInstall;
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
