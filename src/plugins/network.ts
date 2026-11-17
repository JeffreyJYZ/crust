/**
 * `crust:network` — the rules a page's own requests are matched against, and the log of what was
 * seen. This module owns no framework: the interception is a `WKURLSchemeHandler` macOS registers
 * at runtime (`darwinNetworkAdapter`), and a platform without WebKit keeps answering a typed
 * `NotImplemented`.
 * The decision is synchronous by design: WebKit's handler asks once per task and cannot wait, so
 * `decide` matches, logs and answers in one call. A pattern has one wildcard (`*`) and no regular
 * expression, so a page cannot hand the main thread a catastrophic backtrack.
 * An `allow` rule serves the bytes it carries. It is never a pass-through and never a fetch: the
 * handler answers `didReceiveResponse:` / `didReceiveData:` / `didFinish:` itself, and a rule with
 * no body answers an empty `200`.
 */

import {
	definePlugin,
	notImplemented,
	type PluginContext,
	type PluginDefinition,
} from "./define.ts";
import { type MatchOptions, patternMatches } from "./network-match.ts";
import { readRules } from "./network-rules.ts";
import { type NetworkStatusAdapter, readStatus, subscribeStatus } from "./network-status.ts";
import {
	NETWORK_BODY_LIMIT,
	NETWORK_DEFAULT_TYPE,
	NETWORK_LOG_LIMIT,
	NETWORK_SCHEME,
	NETWORK_TYPE_LIMIT,
	NETWORK_URL_LIMIT,
	type NetworkAction,
	type NetworkAdapter,
	type NetworkCommands,
	type NetworkDecision,
	type NetworkInstall,
	type NetworkLogEntry,
	type NetworkRule,
	type NetworkStatus,
} from "./network-types.ts";

export { foldsCase, patternMatches, type MatchOptions } from "./network-match.ts";
export { readRules } from "./network-rules.ts";
export {
	NETWORK_BODY_LIMIT,
	NETWORK_DEFAULT_TYPE,
	NETWORK_LOG_LIMIT,
	NETWORK_SCHEME,
	NETWORK_TYPE_LIMIT,
	NETWORK_URL_LIMIT,
	type NetworkAction,
	type NetworkAdapter,
	type NetworkDecision,
	type NetworkInstall,
	type NetworkLogEntry,
	type NetworkRule,
	type NetworkStatus,
} from "./network-types.ts";

/** One judged request: what the log records, and what the native handler must answer. */
interface Verdict {
	entry: NetworkLogEntry;
	decision: NetworkDecision;
}

export function createNetworkPlugin(
	adapter?: NetworkAdapter,
	options: MatchOptions = {},
	status?: NetworkStatusAdapter,
): PluginDefinition<"network", NetworkCommands> {
	const native = adapter;
	const connectivity = status;
	let rules: NetworkRule[] = [];
	const entries: NetworkLogEntry[] = [];
	let context: PluginContext | undefined;
	let install: NetworkInstall | undefined;

	const missing = (command: string) =>
		notImplemented(
			`network.${command} needs WKURLSchemeHandler, which only WebKit provides. Pass a NetworkAdapter to createNetworkPlugin on a platform that has no webkit.`,
			"WKURLSchemeHandler",
		);

	/**
	 * One decision, made without matching when the URL cannot have been seen whole: a string at the
	 * native buffer's bound is a prefix, and matching a prefix would let a tail-anchored rule be
	 * dodged, so it is blocked and says why in the log.
	 */
	const judge = (url: string): Verdict => {
		if (Buffer.byteLength(url, "utf8") >= NETWORK_URL_LIMIT) {
			return {
				entry: {
					url,
					action: "block",
					status: "blocked",
					reason: `url-too-long: ${NETWORK_URL_LIMIT} bytes is the whole native buffer, so this URL is a truncated prefix and is never matched`,
				},
				decision: { action: "block" },
			};
		}
		const rule = rules.find((candidate) => patternMatches(candidate.pattern, url, options));
		const action: NetworkAction = rule?.action ?? "allow";
		if (action === "block") {
			return { entry: { url, action, status: "blocked" }, decision: { action } };
		}
		const body = rule?.body ?? "";
		const type = rule?.type ?? NETWORK_DEFAULT_TYPE;
		const bytes = Buffer.byteLength(body, "utf8");
		return {
			entry: { url, action, status: "served", bytes },
			decision: { action, body, type },
		};
	};

	/** One call per intercepted task: decide, record, tell the page, answer WebKit. */
	const decide = (url: string): NetworkDecision => {
		const { entry, decision } = judge(url);
		entries.push(entry);
		if (entries.length > NETWORK_LOG_LIMIT) {
			entries.splice(0, entries.length - NETWORK_LOG_LIMIT);
		}
		context?.emit("network:request", entry);
		return decision;
	};

	const ready = (): NetworkInstall => {
		if (install === undefined) {
			install = native
				? native.install(NETWORK_SCHEME, decide)
				: { ok: false, reason: "no adapter" };
		}
		return install;
	};

	const state = () => {
		const landed = ready();
		return {
			ok: true as const,
			scheme: NETWORK_SCHEME,
			rules: [...rules],
			registered: landed.ok,
			reason: landed.reason,
		};
	};

	const commands: NetworkCommands = {
		/** The machine's path to the network, from the OS. Not the interceptor's state. */
		status: async () => readStatus(connectivity),
		/** Subscribe to path changes; each report arrives as `network:change`. */
		onChange: async (_args, ctx) => subscribeStatus(connectivity, ctx),
		/** The rules in force, and whether the scheme handler is registered at all. */
		rules: async (_args, ctx) => {
			if (!native) return missing("rules");
			context = ctx;
			return state();
		},
		/** Replace the whole rule set; the first match wins and no match allows an empty body. */
		setRules: async (args, ctx) => {
			if (!native) return missing("setRules");
			context = ctx;
			rules = readRules(args?.rules);
			return state();
		},
		/** The most recent entries, oldest first, never more than NETWORK_LOG_LIMIT. */
		log: async (_args, ctx) => {
			if (!native) return missing("log");
			context = ctx;
			return { ok: true, entries: [...entries] };
		},
		clearLog: async (_args, ctx) => {
			if (!native) return missing("clearLog");
			context = ctx;
			const cleared = entries.length;
			entries.length = 0;
			return { ok: true, cleared };
		},
	};

	return definePlugin({ name: "network", commands });
}

/** The default registration: honest about the missing framework. */
export const networkPlugin = createNetworkPlugin();
