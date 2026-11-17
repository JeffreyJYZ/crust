/**
 * A recording fake for `crust:navigation`, shared by the two suites so the delegate's callback
 * has one home instead of two copies. It answers what the test asked for and keeps the
 * listener `start` registered, so a test can fire a callback the way WebKit would — no window,
 * no page and no delegate class is ever built.
 */

import type { PluginContext } from "./define";
import type {
	NavigationAdapter,
	NavigationEventKind,
	NavigationEventPayload,
	NavigationInstall,
	NavigationState,
} from "./navigation";

/** The state a fake answers unless the test says otherwise. */
export const READY_STATE: NavigationState = {
	url: "https://crust.dev/",
	title: "crust",
	loading: false,
	canGoBack: true,
	canGoForward: false,
};

export interface RecordedNavigation {
	adapter: NavigationAdapter;
	/** Every command the plugin handed the adapter, in order. */
	calls: string[];
	/** Fire the listener `start` registered, as WebKit would. */
	fire(kind: NavigationEventKind, payload?: NavigationEventPayload): void;
}

export function fakeNavigation(
	options: {
		install?: NavigationInstall;
		state?: NavigationState | null;
		reload?: boolean;
		back?: boolean;
		forward?: boolean;
		load?: boolean;
	} = {},
): RecordedNavigation {
	const calls: string[] = [];
	let listener:
		((kind: NavigationEventKind, payload: NavigationEventPayload) => void) | undefined;
	const adapter: NavigationAdapter = {
		start: (registered) => {
			calls.push("start");
			listener = registered;
			return options.install ?? { ok: true, status: 0, reason: "installed" };
		},
		stop: () => {
			calls.push("stop");
		},
		state: () => {
			calls.push("state");
			return options.state === undefined ? READY_STATE : options.state;
		},
		reload: () => {
			calls.push("reload");
			return options.reload ?? true;
		},
		goBack: () => {
			calls.push("goBack");
			return options.back ?? true;
		},
		goForward: () => {
			calls.push("goForward");
			return options.forward ?? false;
		},
		loadUrl: (url: string) => {
			calls.push(`loadUrl:${url}`);
			return options.load ?? true;
		},
	};
	return {
		adapter,
		calls,
		fire: (kind, payload = { url: READY_STATE.url, title: READY_STATE.title }) =>
			listener?.(kind, payload),
	};
}

/** A context that records what a command pushed. */
export function collector(): {
	events: Array<{ event: string; data: unknown }>;
	ctx: PluginContext;
} {
	const events: Array<{ event: string; data: unknown }> = [];
	return { events, ctx: { emit: (event, data) => events.push({ event, data }) } };
}
