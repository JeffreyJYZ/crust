/**
 * `crust:network`'s rule parsing. The whole set is validated before any of it is stored, so a
 * refused rule leaves the rules in force untouched. Two costs are bounded here rather than at match
 * time — a pattern's length and its wildcard count — because the match runs on the main thread for
 * every request a page makes, and a body is bounded because the native buffer that serves it is
 * fixed (`NET_BODY` in `shim/113_network_serve.c`).
 */

import { CrustError } from "../bridge/errors";
import {
	NETWORK_BODY_LIMIT,
	NETWORK_PATTERN_LIMIT,
	NETWORK_TYPE_LIMIT,
	NETWORK_WILDCARD_LIMIT,
	type NetworkRule,
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

/**
 * The bytes and content type an `allow` rule answers with. A `block` rule that carries either is
 * refused by name, because nothing would ever serve it and a silently ignored field is worse than a
 * refusal.
 */
function readBody(
	entry: { body?: unknown; type?: unknown },
	index: number,
	action: NetworkRule["action"],
): Pick<NetworkRule, "body" | "type"> {
	const body = entry.body;
	const type = entry.type;
	if (body === undefined && type === undefined) return {};
	if (action === "block") {
		throw new CrustError(
			"bad-request",
			`network.setRules: rule ${index} is a block rule and carries a body, which nothing can serve`,
		);
	}
	if (body !== undefined && typeof body !== "string") {
		throw new CrustError(
			"bad-request",
			`network.setRules: rule ${index} needs a string "body"`,
		);
	}
	if (type !== undefined && typeof type !== "string") {
		throw new CrustError(
			"bad-request",
			`network.setRules: rule ${index} needs a string "type"`,
		);
	}
	const bytes = body === undefined ? 0 : Buffer.byteLength(body, "utf8");
	if (bytes > NETWORK_BODY_LIMIT) {
		throw new CrustError(
			"bad-request",
			`network.setRules: rule ${index} serves ${bytes} bytes, and ${NETWORK_BODY_LIMIT} is the whole native buffer`,
		);
	}
	const typeBytes = type === undefined ? 0 : Buffer.byteLength(type, "utf8");
	if (typeBytes > NETWORK_TYPE_LIMIT) {
		throw new CrustError(
			"bad-request",
			`network.setRules: rule ${index} has a ${typeBytes}-byte content type, and ${NETWORK_TYPE_LIMIT} is the whole native buffer`,
		);
	}
	const rule: Pick<NetworkRule, "body" | "type"> = {};
	if (body !== undefined) rule.body = body;
	if (type !== undefined) rule.type = type;
	return rule;
}

export function readRules(value: unknown): NetworkRule[] {
	if (!Array.isArray(value)) {
		throw new CrustError("bad-request", 'network.setRules: "rules" must be an array');
	}
	return value.map((rule, index) => {
		const entry = rule as
			| { pattern?: unknown; action?: unknown; body?: unknown; type?: unknown }
			| null
			| undefined;
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
		return { pattern, action, ...readBody(entry ?? {}, index, action) };
	});
}
