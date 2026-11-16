/**
 * `crust:accessibility` — whether this process may drive the accessibility API, the one system
 * prompt that grants it, and a count of the app's own window's AX children. ApplicationServices is
 * not here: macOS supplies `darwinAccessibilityAdapter()`, and a platform without AX keeps answering
 * a typed `NotImplemented`.
 * `elementCount` is the proof that a window really exposes a tree rather than merely claiming to: it
 * walks the app's own element, and when no window is up it answers `0` with `notImplemented` naming
 * the window, because a count of zero from a window that does not exist is not evidence of anything.
 */

import { definePlugin, type NotImplemented, notImplemented, type PluginDefinition } from "./define";

/**
 * What the walk found. `counted` carries a real number, `noWindowsListed` means the AX window list
 * was empty — a process reading its own tree can get that while a window is on screen — and
 * `refused` means the AX API itself said no.
 */
export const AX_STATUS = { counted: 0, noWindowsListed: 1, refused: 2 } as const;

export interface AxElementReport {
	/** Children of the app's first window; 0 when there is nothing to count. */
	count: number;
	/** One of `AX_STATUS`. */
	status: number;
	reason: string;
}

/** The native half of `crust:accessibility`; `platform/darwin/accessibility.ts` implements it. */
export interface AccessibilityAdapter {
	trusted(): boolean | Promise<boolean>;
	/** Raises the system prompt and answers the state after it: a human answers, so false is common. */
	prompt(): boolean | Promise<boolean>;
	elementCount(): AxElementReport | Promise<AxElementReport>;
}

export interface TrustedResult {
	ok: true;
	trusted: boolean;
}

export interface PromptResult {
	ok: true;
	trusted: boolean;
	/** Always true: the dialog was raised. Whether it was answered is `trusted`. */
	prompted: true;
}

export interface ElementCountResult {
	ok: true;
	/** Children of the app's first window. Zero is a real answer here: a window with no children. */
	count: number;
}

/** The commands in the order this plugin declares them. */
export const ACCESSIBILITY_COMMANDS = ["trusted", "prompt", "elementCount"] as const;

export function createAccessibilityPlugin(adapter?: AccessibilityAdapter): PluginDefinition<
	"accessibility",
	{
		trusted: () => Promise<TrustedResult | NotImplemented>;
		prompt: () => Promise<PromptResult | NotImplemented>;
		elementCount: () => Promise<ElementCountResult | NotImplemented>;
	}
> {
	const missing = (command: string) =>
		notImplemented(
			`accessibility.${command} needs ApplicationServices, which only macOS provides. Pass an ` +
				"AccessibilityAdapter to createAccessibilityPlugin where AX exists.",
			"AXIsProcessTrusted",
		);

	return definePlugin({
		name: "accessibility",
		commands: {
			/** Whether this process may use the AX API. A read: it never raises the dialog. */
			trusted: async (): Promise<TrustedResult | NotImplemented> => {
				if (!adapter) return missing("trusted");
				return { ok: true, trusted: await adapter.trusted() };
			},

			/** Raise the one system prompt that grants trust, and report the state after it. */
			prompt: async (): Promise<PromptResult | NotImplemented> => {
				if (!adapter) return missing("prompt");
				const trusted = await adapter.prompt();
				return { ok: true, trusted, prompted: true };
			},

			/**
			 * Count the AX children of the app's own first window. Measured 2026-11-16: a process
			 * reading its own pid is answered by AppKit locally rather than by the system AX server,
			 * so an empty window list can come back while the window is on screen — the refusal says
			 * that instead of claiming no window exists.
			 */
			elementCount: async (): Promise<ElementCountResult | NotImplemented> => {
				if (!adapter) return missing("elementCount");
				const report = await adapter.elementCount();
				if (report.status === AX_STATUS.counted) return { ok: true, count: report.count };
				if (report.status === AX_STATUS.noWindowsListed) {
					return notImplemented(
						`accessibility.elementCount: 0 elements, because AX listed no windows for this ` +
							`process — ${report.reason}. A process reading its own AX tree is answered by ` +
							"AppKit locally, not by the system AX server, so this is not evidence that the " +
							"window is missing; accessibility.trusted reports whether AX is available.",
						"AXUIElementCopyAttributeValue (AXWindows)",
					);
				}
				return notImplemented(
					`accessibility.elementCount: the AX API refused the walk — ${report.reason}`,
					"AXUIElementCopyAttributeValue",
				);
			},
		},
	});
}

/** The default registration: honest about the missing framework. */
export const accessibilityPlugin = createAccessibilityPlugin();
