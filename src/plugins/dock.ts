/**
 * `crust:dock` — the app's dock tile: its badge, the attention bounce, and a progress bar. AppKit is
 * not here: macOS supplies `darwinDockAdapter()`, and a platform without a dock tile keeps answering
 * a typed `NotImplemented` rather than a fake success — a badge that silently did nothing is
 * indistinguishable from one that failed.
 * `progress` is honest about its one dependency: the bar is an `NSProgressIndicator` installed as the
 * tile's content view, and if that cannot be built the answer is `notImplemented` naming the
 * selector, never a value that pretends a bar appeared.
 */

import { CrustError } from "../bridge/errors";
import { definePlugin, type NotImplemented, notImplemented, type PluginDefinition } from "./define";

/** A refusal that is not a missing platform: the OS or the adapter said no. */
export interface DockFailure {
	ok: false;
	code: "handler-error";
	message: string;
}

/** What a badge call reports: the OS's answer plus the step that produced it. */
export interface DockOutcome {
	ok: boolean;
	reason: string;
}

/** A bounce answers the request id AppKit minted; `ok: false` means AppKit was unreachable. */
export interface DockBounce extends DockOutcome {
	request: number;
}

/** The native half of `crust:dock`; `platform/darwin/dock.ts` implements it. */
export interface DockAdapter {
	setBadge(label: string): DockOutcome | Promise<DockOutcome>;
	badgeLabel(): string | Promise<string>;
	bounce(critical: boolean): DockBounce | Promise<DockBounce>;
	setProgress(value: number): DockOutcome | Promise<DockOutcome>;
}

export interface DockBadgeArgs {
	/** Any short text; the empty string clears the badge, which is how AppKit does it. */
	label: string;
}

export interface DockBounceArgs {
	/** `NSCriticalRequest` (a bounce until the app is frontmost) rather than the one-shot notice. */
	critical?: boolean;
}

export interface DockProgressArgs {
	/** A fraction: 0 is empty, 1 is full. */
	value: number;
}

export interface DockBadgeResult {
	ok: true;
	label: string;
	cleared: boolean;
}

export interface DockLabelResult {
	ok: true;
	label: string;
}

export interface DockBounceResult {
	ok: true;
	critical: boolean;
	request: number;
}

export interface DockProgressResult {
	ok: true;
	value: number;
}

/** The commands in the order this plugin declares them. */
export const DOCK_COMMANDS = ["badge", "badgeLabel", "bounce", "progress"] as const;

function refusal(reason: string): DockFailure {
	return { ok: false, code: "handler-error", message: reason };
}

export function createDockPlugin(adapter?: DockAdapter): PluginDefinition<
	"dock",
	{
		badge: (args: DockBadgeArgs) => Promise<DockBadgeResult | DockFailure | NotImplemented>;
		badgeLabel: () => Promise<DockLabelResult | DockFailure | NotImplemented>;
		bounce: (args: DockBounceArgs) => Promise<DockBounceResult | DockFailure | NotImplemented>;
		progress: (args: DockProgressArgs) => Promise<DockProgressResult | NotImplemented>;
	}
> {
	const missing = (command: string) =>
		notImplemented(
			`dock.${command} needs NSDockTile, which only AppKit provides. Pass a DockAdapter to ` +
				"createDockPlugin on a platform that has no dock tile.",
			"NSDockTile",
		);

	return definePlugin({
		name: "dock",
		native: { requires: "NSDockTile", available: adapter !== undefined },
		commands: {
			/** Set the badge text; an empty string clears it. */
			badge: async (
				args: DockBadgeArgs,
			): Promise<DockBadgeResult | DockFailure | NotImplemented> => {
				if (!adapter) return missing("badge");
				const label = args?.label;
				if (typeof label !== "string") {
					throw new CrustError("bad-request", 'dock.badge: "label" must be a string');
				}
				const outcome = await adapter.setBadge(label);
				if (!outcome.ok) return refusal(outcome.reason);
				return { ok: true, label, cleared: label.length === 0 };
			},

			/** Read back what the tile currently shows; the empty string means no badge. */
			badgeLabel: async (): Promise<DockLabelResult | DockFailure | NotImplemented> => {
				if (!adapter) return missing("badgeLabel");
				const label = await adapter.badgeLabel();
				// The native read returns "" both for "no badge" and for "the C unit did not compile".
				// Re-apply what we just read — an idempotent set, so the tile does not change — to prove
				// the tile is reachable. Without that probe a failed read would be reported as an empty
				// badge, and every other dock command would refuse on the same machine.
				const probe = await adapter.setBadge(label);
				if (!probe.ok) return refusal(probe.reason);
				return { ok: true, label };
			},

			/** Bounce the dock icon until the app is frontmost, or once. */
			bounce: async (
				args: DockBounceArgs,
			): Promise<DockBounceResult | DockFailure | NotImplemented> => {
				if (!adapter) return missing("bounce");
				const critical = args?.critical === true;
				const answer = await adapter.bounce(critical);
				if (!answer.ok) return refusal(answer.reason);
				return { ok: true, critical, request: answer.request };
			},

			/** Draw a determinate bar across the bottom of the tile. */
			progress: async (
				args: DockProgressArgs,
			): Promise<DockProgressResult | NotImplemented> => {
				if (!adapter) return missing("progress");
				const value = args?.value;
				if (
					typeof value !== "number" ||
					!Number.isFinite(value) ||
					value < 0 ||
					value > 1
				) {
					throw new CrustError(
						"bad-request",
						'dock.progress: "value" must be a number between 0 and 1',
					);
				}
				const outcome = await adapter.setProgress(value);
				if (!outcome.ok) {
					return notImplemented(
						`dock.progress: the tile's progress bar could not be installed — ${outcome.reason}`,
						"-[NSDockTile setContentView:]",
					);
				}
				return { ok: true, value };
			},
		},
	});
}

/** The default registration: honest about the missing platform. */
export const dockPlugin = createDockPlugin();
