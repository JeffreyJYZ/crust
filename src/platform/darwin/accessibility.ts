/**
 * The macOS accessibility half behind `crust:accessibility`: whether this process may use the
 * accessibility API, the one system prompt that grants it, and a count of the app's own window's AX
 * children — the measurement that proves a window exposes a tree instead of only claiming to.
 * The C boundary is `accessibility-ffi.ts`; this file is the adapter the plugin takes structurally.
 * `prompt()` is the only call here that raises a system dialog, so it is never made by a test or a
 * probe — only by a command a person invoked.
 */

import { accessibilityUnit, type AccessibilityUnit } from "./accessibility-ffi.ts";

export {
	ACCESSIBILITY_SYMBOL_NAMES,
	accessibilitySource,
	accessibilityUnit,
	accessibilityUnitStatus,
} from "./accessibility-ffi.ts";
export type { AccessibilityUnit } from "./accessibility-ffi.ts";

/**
 * What the walk found. `counted` carries a real number, `noWindowsListed` means the AX window list
 * was empty (which a process reading its own tree can get while a window is on screen), and
 * `refused` means the AX API itself said no — three different answers, reported differently.
 */
export const AX_STATUS = { counted: 0, noWindowsListed: 1, refused: 2 } as const;

export interface AxElementReport {
	/** Children of the app's first window; 0 when there is nothing to count. */
	count: number;
	/** One of `AX_STATUS`. */
	status: number;
	reason: string;
}

/** The native half as this module hands it out; `crust:accessibility` takes it structurally. */
export interface DarwinAccessibilityAdapter {
	trusted(): boolean;
	/** Raises the system prompt and answers the state after it: a human answers, so false is common. */
	prompt(): boolean;
	elementCount(): AxElementReport;
}

const message = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** The unit, or the reason it could not be compiled — a compile failure is a refusal, not a throw. */
function compiled(): AccessibilityUnit | string {
	try {
		return accessibilityUnit();
	} catch (error) {
		return `the accessibility C unit did not compile: ${message(error)}`;
	}
}

function reasonOf(unit: AccessibilityUnit, fallback: string): string {
	const reason = String(unit.symbols.crust_ax_reason() ?? "");
	return reason.length > 0 ? reason : fallback;
}

/** A count of 0 or more is `counted`; the C unit's own negatives are the two refusals. */
function report(unit: AccessibilityUnit, answer: number): AxElementReport {
	const reason = reasonOf(unit, `crust_ax_element_count answered ${answer}`);
	if (answer >= 0) return { count: answer, status: AX_STATUS.counted, reason };
	return {
		count: 0,
		status: answer === -1 ? AX_STATUS.noWindowsListed : AX_STATUS.refused,
		reason,
	};
}

/** The native half of `crust:accessibility`; see the file comment for the prompt rule. */
export function darwinAccessibilityAdapter(): DarwinAccessibilityAdapter {
	return {
		trusted: () => {
			const unit = compiled();
			if (typeof unit === "string") return false;
			return Number(unit.symbols.crust_ax_trusted() ?? 0) === 1;
		},
		prompt: () => {
			const unit = compiled();
			if (typeof unit === "string") throw new Error(unit);
			return Number(unit.symbols.crust_ax_prompt() ?? 0) === 1;
		},
		elementCount: () => {
			const unit = compiled();
			if (typeof unit === "string") {
				return { count: 0, status: AX_STATUS.refused, reason: unit };
			}
			return report(unit, Number(unit.symbols.crust_ax_element_count() ?? -2));
		},
	};
}
