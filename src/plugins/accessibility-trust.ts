/**
 * The trust-probe commands of `crust:accessibility`: whether this process may use the AX API, the one
 * system prompt that grants it, and a count of the app's own window's AX children — the measurement
 * that proves a window exposes a tree instead of only claiming to.
 * Split out of `accessibility.ts` so the page-facing announce/title/focus trio fits beside it without
 * either file passing the line cap. Every refusal is a typed value, never a throw.
 */

import {
	type AccessibilityAdapter,
	AX_STATUS,
	type AxElementReport,
	type NeedsActivationFailure,
} from "./accessibility-types";
import { activationRefused, demandActivation } from "./activation-policy";
import { type NotImplemented, notImplemented } from "./define";

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

/** A native refusal (e.g. the AX unit did not compile), converted from an adapter throw. */
export interface PromptFailure {
	ok: false;
	code: "handler-error";
	message: string;
}

export interface ElementCountResult {
	ok: true;
	/** Children of the app's first window. Zero is a real answer here: a window with no children. */
	count: number;
}

export interface TrustCommandResults {
	trusted: () => Promise<TrustedResult | NotImplemented>;
	prompt: () => Promise<PromptResult | PromptFailure | NotImplemented>;
	elementCount: () => Promise<ElementCountResult | NeedsActivationFailure | NotImplemented>;
}

export function trustCommands(
	adapter: AccessibilityAdapter | undefined,
	missing: (command: string) => NotImplemented,
): TrustCommandResults {
	return {
		/** Whether this process may use the AX API. A read: it never raises the dialog. */
		trusted: async (): Promise<TrustedResult | NotImplemented> => {
			if (!adapter) return missing("trusted");
			return { ok: true, trusted: await adapter.trusted() };
		},

		/** Raise the one system prompt that grants trust, and report the state after it. */
		prompt: async (): Promise<PromptResult | PromptFailure | NotImplemented> => {
			if (!adapter) return missing("prompt");
			try {
				const trusted = await adapter.prompt();
				return { ok: true, trusted, prompted: true };
			} catch (error) {
				return {
					ok: false,
					code: "handler-error",
					message: error instanceof Error ? error.message : String(error),
				};
			}
		},

		/**
		 * Count the AX children of the app's own first window. Measured 2026-11-16: a process reading
		 * its own pid is answered by AppKit locally rather than by the system AX server, so an empty
		 * window list can come back while the window is on screen — the refusal says that instead of
		 * claiming no window exists.
		 *
		 * `testing.activation` reaches this read first: `none` refuses by name rather than handing back
		 * the empty tree activation would explain, and `on-demand` raises the app once, because an
		 * inactive app has no window on the active Space to count.
		 */
		elementCount: async (): Promise<
			ElementCountResult | NeedsActivationFailure | NotImplemented
		> => {
			if (!adapter) return missing("elementCount");
			if (activationRefused()) {
				return {
					ok: false,
					code: "needs-activation",
					message:
						"accessibility.elementCount needs the app active: AppKit lists only windows on " +
						'the active Space, and testing.activation is "none", so this launch never ' +
						'activated. Use "on-demand" (activates once here) or "auto", or read the page ' +
						"with testing.query, which needs no activation.",
				};
			}
			demandActivation();
			const report: AxElementReport = await adapter.elementCount();
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
	};
}
