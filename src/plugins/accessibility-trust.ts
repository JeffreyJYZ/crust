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

/** A native refusal (e.g. the AX unit did not compile), converted from an adapter throw. */
export interface PromptFailure {
	ok: false;
	code: "handler-error" | "native-unavailable";
	message: string;
}

/**
 * These two reads include the adapter throw in their own result type, not just in the handler's:
 * the public command map in `accessibility.ts` names only this alias, so widening here widens the
 * page-facing contract without a second edit there. A caller branching on `ok` still gets the same
 * success shape; the `ok: false` arm is the typed refusal the rest of the namespace promises.
 */
export type TrustedResult = { ok: true; trusted: boolean } | PromptFailure;

export interface PromptResult {
	ok: true;
	trusted: boolean;
	/** Always true: the dialog was raised. Whether it was answered is `trusted`. */
	prompted: true;
}

export type ElementCountResult =
	| {
			ok: true;
			/** Children of the app's first window. Zero is a real answer here: a window with no children. */
			count: number;
	  }
	| PromptFailure;

export interface TrustCommandResults {
	trusted: () => Promise<TrustedResult | NotImplemented>;
	prompt: () => Promise<PromptResult | PromptFailure | NotImplemented>;
	elementCount: () => Promise<ElementCountResult | NeedsActivationFailure | NotImplemented>;
}

/** One conversion for every adapter fault, so all three commands refuse in the same shape. */
const adapterFault = (error: unknown): PromptFailure => {
	// An adapter can name its own refusal ("native-unavailable" on a compile failure) so a page can
	// tell a missing native half from an AX permission answer that genuinely came back false.
	const code = (error as { code?: unknown } | null)?.code;
	return {
		ok: false,
		code: code === "native-unavailable" ? code : "handler-error",
		message: error instanceof Error ? error.message : String(error),
	};
};

export function trustCommands(
	adapter: AccessibilityAdapter | undefined,
	missing: (command: string) => NotImplemented,
): TrustCommandResults {
	return {
		/** Whether this process may use the AX API. A read: it never raises the dialog. */
		trusted: async (): Promise<TrustedResult | NotImplemented> => {
			if (!adapter) return missing("trusted");
			try {
				return { ok: true, trusted: await adapter.trusted() };
			} catch (error) {
				return adapterFault(error);
			}
		},

		/** Raise the one system prompt that grants trust, and report the state after it. */
		prompt: async (): Promise<PromptResult | PromptFailure | NotImplemented> => {
			if (!adapter) return missing("prompt");
			try {
				const trusted = await adapter.prompt();
				return { ok: true, trusted, prompted: true };
			} catch (error) {
				return adapterFault(error);
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
			let report: AxElementReport;
			try {
				report = await adapter.elementCount();
			} catch (error) {
				return adapterFault(error);
			}
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
