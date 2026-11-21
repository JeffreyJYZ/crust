/**
 * The macOS accessibility half behind `crust:accessibility`: whether this process may use the
 * accessibility API, the one system prompt that grants it, and a count of the app's own window's AX
 * children — the measurement that proves a window exposes a tree instead of only claiming to.
 * The C boundary is `accessibility-ffi.ts`; this file is the adapter the plugin takes structurally.
 * `prompt()` is the only call here that raises a system dialog, so it is never made by a test or a
 * probe — only by a command a person invoked.
 */

import { accessibilityUnit, type AccessibilityUnit } from "./accessibility-ffi.ts";
import { accessibilityPageUnit, type AccessibilityPageUnit } from "./accessibility-page-ffi.ts";
import { cstr } from "./objc.ts";
import type {
	AnnouncePriority,
	AnnounceReport,
	FocusReport,
	TitleReport,
} from "@/plugins/accessibility-types";

export {
	ACCESSIBILITY_PAGE_SYMBOL_NAMES,
	accessibilityPageSource,
	accessibilityPageUnit,
	accessibilityPageUnitStatus,
} from "./accessibility-page-ffi.ts";
export {
	ACCESSIBILITY_SYMBOL_NAMES,
	accessibilitySource,
	accessibilityUnit,
	accessibilityUnitStatus,
} from "./accessibility-ffi.ts";
export type { AccessibilityUnit } from "./accessibility-ffi.ts";
export type { AccessibilityPageUnit } from "./accessibility-page-ffi.ts";

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
	/** Post an announcement; `announced` is the post, not the speech. */
	announce(text: string, priority: AnnouncePriority): AnnounceReport;
	/** Set the window's accessible name. No label means the key window. */
	title(text: string, label?: string): TitleReport;
	/** Move assistive focus to a window. No label means the key window. */
	focus(label?: string): FocusReport;
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

/** A count of 0 or more is `counted`. Only -1 means an empty AX list; -2/-3 are refusals. */
export function axElementReport(reason: string, answer: number): AxElementReport {
	if (answer >= 0) return { count: answer, status: AX_STATUS.counted, reason };
	return {
		count: 0,
		status: answer === -1 ? AX_STATUS.noWindowsListed : AX_STATUS.refused,
		reason,
	};
}

function report(unit: AccessibilityUnit, answer: number): AxElementReport {
	return axElementReport(reasonOf(unit, `crust_ax_element_count answered ${answer}`), answer);
}

/** The page unit, or the reason it could not be compiled — a refusal, never a throw. */
function pageCompiled(): AccessibilityPageUnit | string {
	try {
		return accessibilityPageUnit();
	} catch (error) {
		return `the accessibility page C unit did not compile: ${message(error)}`;
	}
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
		announce: (text, priority) => {
			const unit = pageCompiled();
			if (typeof unit === "string") return { announced: false, reason: unit };
			const posted = Number(
				unit.symbols.crust_ax_announce(cstr(text), priority === "assertive" ? 1 : 0) ?? 0,
			);
			return posted === 1
				? { announced: true, reason: "AXAnnouncementRequestedNotification was posted" }
				: { announced: false, reason: "the announcement dictionary could not be built" };
		},
		title: (text, label) => {
			const unit = pageCompiled();
			if (typeof unit === "string") return { titled: false, reason: unit };
			const applied = Number(unit.symbols.crust_ax_title(cstr(text), cstr(label ?? "")) ?? 0);
			return applied === 1
				? { titled: true, reason: "setAccessibilityLabel: was applied" }
				: {
						titled: false,
						reason: `no window named ${JSON.stringify(label ?? "")} accepted an accessible label`,
					};
		},
		focus: (label) => {
			const unit = pageCompiled();
			if (typeof unit === "string") return { focused: false, reason: unit };
			const moved = Number(unit.symbols.crust_ax_focus(cstr(label ?? "")) ?? 0);
			return moved === 1
				? { focused: true, reason: "AXFocusedWindow and AXFocused were set and posted" }
				: {
						focused: false,
						reason: `no AX window matched ${JSON.stringify(label ?? "the key window")}`,
					};
		},
	};
}
