/**
 * The listener bookkeeping behind `crust:navigation`'s `start` and `stop`. A native delegate is
 * installed once per target and fans every callback out to all pages listening on that target.
 *
 * A second `start` must not call the adapter's `start` again: the platform keeps one listener per
 * webview and its "already installed" branch deletes the first page's entry, which silences events
 * for everyone. Here the second caller only registers another page and gets the first install's
 * answer. `stop` removes one page and uninstalls only when the last page leaves.
 *
 * The per-page key must not be `emit`: the bridge hands every handler the same process-wide emit,
 * so two pages collapsed into one entry and one page's `stop` silenced the other. `ctx.pageId` is
 * minted per document and forwarded by the runner; `emit` remains the fallback for direct callers.
 */
import type { PluginContext } from "./define";
import { failure } from "./navigation-target";
import type {
	NavigationAdapter,
	NavigationEventKind,
	NavigationEventPayload,
	NavigationFailure,
} from "./navigation-types";

type Identity = string | PluginContext["emit"];

type Installed = {
	pages: Map<Identity, PluginContext["emit"]>;
	status: number;
	reason: string;
};

export type StartAnswer = { ok: true; status: number; reason: string } | NavigationFailure;
export type StopAnswer = { ok: true; stopped: boolean } | NavigationFailure;

export class NavigationListeners {
	readonly #installs = new Map<string, Installed>();

	private key(label?: string): string {
		return label ?? "";
	}

	start(
		web: NavigationAdapter,
		label: string | undefined,
		emit: PluginContext["emit"],
		pageId?: string,
	): StartAnswer {
		const key = this.key(label);
		const identity: Identity = pageId ?? emit;
		const current = this.#installs.get(key);
		if (current) {
			current.pages.set(identity, emit);
			return { ok: true, status: current.status, reason: current.reason };
		}
		const pages = new Map<Identity, PluginContext["emit"]>([[identity, emit]]);
		const listener = (kind: NavigationEventKind, payload: NavigationEventPayload): void => {
			for (const send of pages.values()) {
				try {
					send(`navigation:${kind}`, payload);
				} catch {
					// A page handler that throws must not unwind into AppKit's delegate call.
				}
			}
		};
		const installed = web.start(listener, label);
		if (!installed.ok) {
			return { ok: false, code: "handler-error", message: installed.reason };
		}
		this.#installs.set(key, { pages, status: installed.status, reason: installed.reason });
		return { ok: true, status: installed.status, reason: installed.reason };
	}

	stop(
		web: NavigationAdapter,
		label: string | undefined,
		emit: PluginContext["emit"],
		pageId?: string,
	): StopAnswer {
		const key = this.key(label);
		const current = this.#installs.get(key);
		if (current) {
			current.pages.delete(pageId ?? emit);
			if (current.pages.size > 0) return { ok: true, stopped: false };
			this.#installs.delete(key);
		}
		try {
			web.stop(label);
			return { ok: true, stopped: true };
		} catch (error) {
			// An unknown label is the resolver's refusal, which the caller can fix; any other
			// throw still means the delegate is gone either way, which is what `stop` promised.
			const refused = failure(error);
			if (refused.code === "bad-request") return refused;
			return { ok: true, stopped: false };
		}
	}
}
