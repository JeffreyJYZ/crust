/**
 * `crust:accessibility` — one plugin, two surfaces.
 *
 * - `announce`, `title` and `focus` are what a page uses to speak through the platform's accessibility
 *   layer: Butter's `a11y:announce` / `a11y:title` / `a11y:focus`, as commands so nothing depends on a
 *   live-region DOM shim the page has to build itself. The handlers live in `accessibility-page.ts`.
 * - `trusted`, `prompt` and `elementCount` are the trust probe: whether the OS will expose the tree, the
 *   one system dialog that grants it, and a count of the app's own AX children. Those live in
 *   `accessibility-trust.ts`.
 *
 * This file is only the composition root, and the one place that decides which platform call a refusal
 * names. A page-facing command is never gated on `trusted`: an untrusted process still posts and the OS
 * drops it, so the answer reports both facts instead of claiming a policy the OS does not apply.
 */

import {
	type AnnounceArgs,
	type AnnounceResult,
	type FocusArgs,
	type FocusResult,
	type PageGuards,
	pageCommands,
	type TitleArgs,
	type TitleResult,
} from "./accessibility-page";
import { accessibilityNeed, accessibilityRequires } from "./accessibility-requires";
import {
	type ElementCountResult,
	type PromptFailure,
	type PromptResult,
	type TrustedResult,
	trustCommands,
} from "./accessibility-trust";
import type {
	AccessibilityAdapter,
	AccessibilityFailure,
	AnnouncePriority,
	NeedsActivationFailure,
} from "./accessibility-types";
import { definePlugin, type NotImplemented, notImplemented, type PluginDefinition } from "./define";

export type {
	AnnounceArgs,
	AnnounceResult,
	FocusArgs,
	FocusResult,
	TitleArgs,
	TitleResult,
} from "./accessibility-page";
export {
	accessibilityNeed,
	accessibilityRequires,
	hasAnnouncement,
} from "./accessibility-requires";
export type {
	ElementCountResult,
	PromptFailure,
	PromptResult,
	TrustedResult,
} from "./accessibility-trust";
export {
	type AccessibilityAdapter,
	type AccessibilityFailure,
	type AnnouncePriority,
	type AnnounceReport,
	AX_STATUS,
	type AxElementReport,
	type FocusReport,
	type NeedsActivationFailure,
	type TitleReport,
} from "./accessibility-types";

/** The commands in the order this plugin declares them. */
export const ACCESSIBILITY_COMMANDS = [
	"trusted",
	"prompt",
	"elementCount",
	"announce",
	"title",
	"focus",
] as const;

export interface AccessibilityOptions {
	/** `process.platform`; the default, so a refusal names the right platform's call. */
	platform?: string;
}

export function createAccessibilityPlugin(
	adapter?: AccessibilityAdapter,
	options: AccessibilityOptions = {},
): PluginDefinition<
	"accessibility",
	{
		trusted: () => Promise<TrustedResult | NotImplemented>;
		prompt: () => Promise<PromptResult | PromptFailure | NotImplemented>;
		elementCount: () => Promise<ElementCountResult | NeedsActivationFailure | NotImplemented>;
		announce: (
			args: AnnounceArgs | undefined,
		) => Promise<AnnounceResult | AccessibilityFailure | NotImplemented>;
		title: (
			args: TitleArgs | undefined,
		) => Promise<TitleResult | AccessibilityFailure | NotImplemented>;
		focus: (
			args: FocusArgs | undefined,
		) => Promise<FocusResult | AccessibilityFailure | NotImplemented>;
	}
> {
	const platform = options.platform ?? process.platform;
	const missing = (command: string) => {
		const need = accessibilityNeed(command as "trusted", platform);
		return notImplemented(
			`accessibility.${command} has no native half on this platform: ${need.reason}. Pass an ` +
				"AccessibilityAdapter to createAccessibilityPlugin where that call exists.",
			need.requires,
		);
	};

	/** A page surface the adapter does not carry: named, never a silent success. */
	const unsupported = (command: "announce" | "title" | "focus") => {
		const need = accessibilityNeed(command, platform);
		return notImplemented(
			`accessibility.${command}: this app passed an adapter without that method. Needs ` +
				`${need.requires} — ${need.reason}.`,
			need.requires,
		);
	};

	const guards: PageGuards = { missing, unsupported };

	return definePlugin({
		name: "accessibility",
		native: {
			requires: accessibilityNeed("trusted", platform).requires,
			available: adapter !== undefined,
		},
		commands: {
			...trustCommands(adapter, missing),
			...pageCommands(adapter, guards),
		},
	});
}

/** The default registration: honest about the missing framework. */
export const accessibilityPlugin = createAccessibilityPlugin();
