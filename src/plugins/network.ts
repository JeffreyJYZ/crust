/**
 * `crust:network` — the rules a page's own requests are matched against, and the log of what was
 * seen. This module owns no framework: the interception is a `WKURLSchemeHandler` macOS registers
 * at runtime (`darwinNetworkAdapter`), and a platform without WebKit keeps answering a typed
 * `NotImplemented`.
 * The decision is synchronous by design: WebKit's handler asks once per task and cannot wait, so
 * `decide` matches, logs and emits in one call. A pattern has one wildcard (`*`) and no regular
 * expression, so a page cannot hand the main thread a catastrophic backtrack.
 */

import { CrustError } from "../bridge/errors";
import {
	definePlugin,
	notImplemented,
	type PluginContext,
	type PluginDefinition,
} from "./define.ts";
import { type MatchOptions, patternMatches } from "./network-match.ts";
import {
	NETWORK_LOG_LIMIT,
	NETWORK_PATTERN_LIMIT,
	NETWORK_SCHEME,
	NETWORK_URL_LIMIT,
	NETWORK_WILDCARD_LIMIT,
	type NetworkAction,
	type NetworkAdapter,
	type NetworkCommands,
	type NetworkInstall,
	type NetworkLogEntry,
	type NetworkRule,
	type NetworkStatus,
} from "./network-types.ts";

export { foldsCase, patternMatches, type MatchOptions } from "./network-match.ts";
export {
	NETWORK_LOG_LIMIT,
	NETWORK_SCHEME,
	NETWORK_URL_LIMIT,
	type NetworkAction,
	type NetworkAdapter,
	type NetworkInstall,
	type NetworkLogEntry,
	type NetworkRule,
	type NetworkStatus,
} from "./network-types.ts";

/** A pattern with more stars than this, or longer than any URL, is refused rather than matched. */
function checkCost(pattern: string, index: number): void {
	if (pattern.length > NETWORK_PATTERN_LIMIT) {
		throw new CrustError(
			"bad-request",
			`network.setRules: rule ${index} has a ${pattern.length}-character pattern, and ${NETWORK_PATTERN_LIMIT} is the most a URL can match`,
		);
	}
	const stars = pattern.split("*").length - 1;
	if (stars > NETWORK_WILDCARD_LIMIT) {
		throw new CrustError(
			"bad-request",
			`network.setRules: rule ${index} has ${stars} wildcards, and ${NETWORK_WILDCARD_LIMIT} is the most one pattern may carry`,
		);
	}
}

function readRules(value: unknown): NetworkRule[] {
	if (!Array.isArray(value)) {
		throw new CrustError("bad-request", 'network.setRules: "rules" must be an array');
	}
	return value.map((rule, index) => {
		const entry = rule as { pattern?: unknown; action?: unknown } | null | undefined;
		const pattern = entry?.pattern;
		const action = entry?.action;
		if (typeof pattern !== "string" || pattern.length === 0) {
			throw new CrustError(
				"bad-request",
				`network.setRules: rule ${index} needs a non-empty "pattern"`,
			);
		}
		if (action !== "allow" && action !== "block") {
			throw new CrustError(
				"bad-request",
				`network.setRules: rule ${index} needs "action" allow or block`,
			);
		}
		checkCost(pattern, index);
		return { pattern, action };
	});
}

export function createNetworkPlugin(
	adapter?: NetworkAdapter,
	options: MatchOptions = {},
): PluginDefinition<"network", NetworkCommands> {
	const native = adapter;
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
	const judge = (url: string): NetworkLogEntry => {
		if (Buffer.byteLength(url, "utf8") >= NETWORK_URL_LIMIT) {
			return {
				url,
				action: "block",
				status: "blocked",
				reason: `url-too-long: ${NETWORK_URL_LIMIT} bytes is the whole native buffer, so this URL is a truncated prefix and is never matched`,
			};
		}
		const action = rules.find((rule) => patternMatches(rule.pattern, url, options))?.action;
		const decided: NetworkAction = action ?? "allow";
		const status: NetworkStatus = decided === "block" ? "blocked" : "served";
		return { url, action: decided, status };
	};

	/** One call per intercepted task: decide, record, tell the page, answer WebKit. */
	const decide = (url: string): NetworkAction => {
		const entry = judge(url);
		entries.push(entry);
		if (entries.length > NETWORK_LOG_LIMIT) {
			entries.splice(0, entries.length - NETWORK_LOG_LIMIT);
		}
		context?.emit("network:request", entry);
		return entry.action;
	};

	const ready = (): NetworkInstall => {
		if (install === undefined) {
			install = native
				? native.install(NETWORK_SCHEME, decide)
				: { ok: false, reason: "no adapter" };
		}
		return install;
	};

	const commands: NetworkCommands = {
		/** The rules in force, and whether the scheme handler is registered at all. */
		rules: async (_args, ctx) => {
			if (!native) return missing("rules");
			context = ctx;
			const state = ready();
			return {
				ok: true,
				scheme: NETWORK_SCHEME,
				rules: [...rules],
				registered: state.ok,
				reason: state.reason,
			};
		},
		/** Replace the whole rule set; the first match wins and no match allows. */
		setRules: async (args, ctx) => {
			if (!native) return missing("setRules");
			context = ctx;
			rules = readRules(args?.rules);
			const state = ready();
			return {
				ok: true,
				scheme: NETWORK_SCHEME,
				rules: [...rules],
				registered: state.ok,
				reason: state.reason,
			};
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
