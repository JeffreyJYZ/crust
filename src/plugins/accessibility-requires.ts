/**
 * Which platform call an accessibility command is waiting on, named per platform so a refusal is
 * actionable rather than "not supported here".
 *
 * `announce` is the one that is genuinely absent twice over: Linux's only real announcement is
 * `gtk_widget_announce`, which GTK 4 carries and GTK 3 — the toolkit this shim loads — does not, and
 * Windows has no announcement event at all. `NotifyWinEvent` with `EVENT_OBJECT_LIVEREGIONCHANGED` is a
 * live-region *change* notification a screen reader may read on its own schedule; it is not a request to
 * speak a string, so it is refused by name instead of being wired up and called an announcement.
 *
 * `requires` is the bare symbol, because that is what a caller pattern-matches; `reason` is the sentence
 * a person reads. Keeping them apart is why `requires` names a call and not a paragraph.
 */

export type AccessibilityCommand =
	"trusted" | "prompt" | "elementCount" | "announce" | "title" | "focus";

export type AccessibilityPlatform = "darwin" | "linux" | "win32" | (string & {});

export interface AccessibilityNeed {
	/** The call or framework the command waits on — the value `requires` carries. */
	requires: string;
	/** Why this platform cannot answer, in one clause a person can act on. */
	reason: string;
}

const NEEDS: Record<string, Record<AccessibilityCommand, AccessibilityNeed>> = {
	linux: {
		trusted: {
			requires: "libatk",
			reason: "Linux has no process-level accessibility trust concept",
		},
		prompt: { requires: "libatk", reason: "Linux has no accessibility trust dialog" },
		elementCount: {
			requires: "libatk",
			reason: "crust's Linux shim carries no ATK tree walk",
		},
		announce: {
			requires: "gtk_widget_announce",
			reason: "GTK 4 carries gtk_widget_announce and GTK 3 — which this shim loads — has no announcement call",
		},
		title: {
			requires: "gtk_accessible_update_property",
			reason: "GTK 3 sets an accessible name only through ATK, which this shim does not load",
		},
		focus: {
			requires: "gtk_widget_grab_focus",
			reason: "no accessible-focus move exists outside a widget on GTK 3",
		},
	},
	win32: {
		trusted: {
			requires: "IUIAutomation",
			reason: "crust's Windows shim carries no UIA client",
		},
		prompt: { requires: "IUIAutomation", reason: "Windows has no accessibility trust dialog" },
		elementCount: {
			requires: "IUIAutomation::ElementFromHandle",
			reason: "no UIA element walk is wired on Windows",
		},
		announce: {
			requires: "NotifyWinEvent EVENT_OBJECT_LIVEREGIONCHANGED",
			reason: "that is a live-region change a screen reader reads on its own schedule, not a request to speak, so Windows has no announcement event",
		},
		title: {
			requires: "IUIAutomationElement UIA_NamePropertyId",
			reason: "SetWindowTextW sets the visible title, which is a different string",
		},
		focus: {
			requires: "IUIAutomationElement::SetFocus",
			reason: "no UIA focus call is wired on Windows",
		},
	},
	darwin: {
		trusted: { requires: "AXIsProcessTrusted", reason: "reads whether AX is granted" },
		prompt: {
			requires: "AXIsProcessTrustedWithOptions",
			reason: "raises the one system dialog",
		},
		elementCount: {
			requires: "AXUIElementCopyAttributeValue",
			reason: "walks the app's own tree",
		},
		announce: {
			requires: "NSAccessibilityAnnouncementRequestedNotification",
			reason: "posts an announcement with NSAccessibilityPostNotificationWithUserInfo",
		},
		title: {
			requires: "setAccessibilityLabel:",
			reason: "names the window for a screen reader",
		},
		focus: {
			requires: "AXUIElementSetAttributeValue (AXFocused)",
			reason: "moves assistive focus to the window",
		},
	},
};

/** What one command needs on one platform. An unknown platform is told so rather than guessed at. */
export function accessibilityNeed(
	command: AccessibilityCommand,
	platform: AccessibilityPlatform,
): AccessibilityNeed {
	const known = NEEDS[platform];
	if (known) return known[command];
	return {
		requires: "an accessibility adapter",
		reason: `${platform} has no accessibility half in crust`,
	};
}

/** The bare symbol a refusal carries — the shape every `not-implemented` answer reports. */
export function accessibilityRequires(
	command: AccessibilityCommand,
	platform: AccessibilityPlatform,
): string {
	return accessibilityNeed(command, platform).requires;
}

/** Whether the platform has a real announcement surface at all. Only macOS does today. */
export function hasAnnouncement(platform: AccessibilityPlatform): boolean {
	return platform === "darwin";
}
