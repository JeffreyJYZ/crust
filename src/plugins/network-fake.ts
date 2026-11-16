/**
 * The shared fake for the `crust:network` suites, the way `downloads-fake.ts` serves its own: one
 * adapter that keeps the handler so a test can ask it what WebKit would, one recording
 * `PluginContext`, and one `ok()` that turns a `NotImplemented` into a failure that names itself.
 */

import { isNotImplemented, type NotImplemented } from "@/plugins/define.ts";
import type { NetworkAdapter, NetworkDecision, NetworkInstall } from "@/plugins/network.ts";

/** A result the test knows landed: a `NotImplemented` becomes a failure with its own message. */
export function ok<T>(value: T | NotImplemented): T {
	if (isNotImplemented(value)) throw new Error(`not-implemented: ${value.message}`);
	return value;
}

export interface FakeNetwork {
	adapter: NetworkAdapter;
	/** The scheme each install was asked for. */
	schemes: string[];
	/** Ask the rule set the way WebKit's handler does. */
	decide: (url: string) => NetworkDecision | undefined;
}

export function fakeNetwork(
	install: NetworkInstall = { ok: true, reason: "registered" },
): FakeNetwork {
	const schemes: string[] = [];
	let decide: ((url: string) => NetworkDecision) | undefined;
	const adapter: NetworkAdapter = {
		install(scheme, handler) {
			schemes.push(scheme);
			decide = handler;
			return install;
		},
	};
	return { adapter, schemes, decide: (url) => decide?.(url) };
}

export interface Recorder {
	events: { event: string; data: unknown }[];
	ctx: { emit: (event: string, data: unknown) => void };
}

export function recorder(): Recorder {
	const events: { event: string; data: unknown }[] = [];
	return { events, ctx: { emit: (event, data) => events.push({ event, data }) } };
}
