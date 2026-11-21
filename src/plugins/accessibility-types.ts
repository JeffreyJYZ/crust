/**
 * The shapes `crust:accessibility` shares between its plugin half and the native halves. Split out
 * of `accessibility.ts` so both stay under the line cap now that the page-facing announce/title/focus
 * trio sits beside the trust probe.
 */

/** How an announcement is spoken. `assertive` interrupts; `polite` waits for a gap. */
export type AnnouncePriority = "polite" | "assertive";

/** The priority a caller meant; anything but `assertive` is `polite`, which is Butter's own default. */
export function priorityOf(value: unknown): AnnouncePriority {
	return value === "assertive" ? "assertive" : "polite";
}

/**
 * What the walk found. `counted` carries a real number, `noWindowsListed` means the AX window list
 * was empty — a process reading its own tree can get that while a window is on screen — and
 * `refused` means the AX API itself said no.
 */
export const AX_STATUS = {
	counted: 0,
	noWindowsListed: 1,
	refused: 2,
} as const;

export interface AxElementReport {
	/** Children of the app's first window; 0 when there is nothing to count. */
	count: number;
	/** One of `AX_STATUS`. */
	status: number;
	reason: string;
}

/** What a native announcement produced. `announced: false` is the OS dropping it, not a throw. */
export interface AnnounceReport {
	announced: boolean;
	reason: string;
}

/** What a native accessible-name attempt produced. */
export interface TitleReport {
	titled: boolean;
	reason: string;
}

/** What a native focus attempt produced. */
export interface FocusReport {
	focused: boolean;
	reason: string;
}

/** The refusal shape the page-facing commands answer instead of throwing. */
export interface AccessibilityFailure {
	ok: false;
	code: "bad-request" | "handler-error" | "needs-activation";
	message: string;
}

/**
 * What a tree read answers when `testing.activation` is `"none"`: not an empty tree, and not a
 * `not-implemented` about the platform, but the one thing the caller can act on — the app was never
 * activated, so AppKit lists no window on the active Space.
 */
export interface NeedsActivationFailure {
	ok: false;
	code: "needs-activation";
	message: string;
}

/**
 * The native half of `crust:accessibility`. A platform without AX passes nothing and every command
 * answers `not-implemented`; macOS passes `darwinAccessibilityAdapter()`.
 */
export interface AccessibilityAdapter {
	trusted(): boolean | Promise<boolean>;
	/** Raises the system prompt and answers the state after it: a human answers, so false is common. */
	prompt(): boolean | Promise<boolean>;
	elementCount(): AxElementReport | Promise<AxElementReport>;
	/**
	 * Speak `text` through the platform's announcement surface. `trusted: false` is not a refusal
	 * here: the OS drops an announcement from an untrusted process, and the answer says so.
	 */
	announce?(text: string, priority: AnnouncePriority): AnnounceReport | Promise<AnnounceReport>;
	/** Set the window's accessible name — what a screen reader reads when it lands on the window. */
	title?(text: string, label?: string): TitleReport | Promise<TitleReport>;
	/** Move assistive focus to a window. */
	focus?(label?: string): FocusReport | Promise<FocusReport>;
}
