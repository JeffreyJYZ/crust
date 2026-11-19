/**
 * `crust:testing`'s public vocabulary: what every command takes, what the page answers, and the
 * native half the plugin is given.
 *
 * The namespace exists for an agent to drive a running app from inside its own page: `click` and
 * `type` dispatch ordinary DOM events in the window's own webview, so nothing posts a CGEvent and
 * no Accessibility or Screen Recording grant is ever asked for. The native half is a single
 * `evaluateJavaScript` call, which is why the adapter is one method rather than an operating-system
 * surface — a platform that cannot evaluate a script answers `not-implemented` naming the call.
 */

import type { CommandMap, NotImplemented } from "./define";

/** What the platform supplies: run one script in one window's page, and answer its result. */
export interface TestingAdapter {
	/**
	 * Run `source` as an expression in the page named by `label`, and answer what it evaluated to.
	 * A label that names no open window must throw an error whose `code` is `"unknown-window"`;
	 * everything else it throws becomes `handler-error`. The page's own throw arrives as a
	 * rejection, because `-evaluateJavaScript:completionHandler:` reports it as an `NSError`.
	 */
	evaluate(label: string | undefined, source: string): Promise<unknown>;
}

/** The codes a `testing` command refuses with; `unknown-window` and `handler-error` are the same
 * spelling the `window` plugin uses, so a caller branches once across both namespaces. */
export type TestingCode = "unknown-window" | "not-found" | "not-implemented" | "handler-error";

/** The typed failure every command answers instead of resolving `undefined`. */
export interface TestingFailure {
	readonly ok: false;
	readonly code: TestingCode;
	readonly message: string;
	/** The API a `not-implemented` answer is waiting on. */
	readonly requires?: string;
}

/** Every command takes the window it acts on. Omitted means the app's first open window. */
export interface TestingArgs {
	label?: string;
}

/** What a selector command takes: `click`, `hover`, `query` and `waitFor` share it. */
export interface TestingSelectorArgs extends TestingArgs {
	selector: string;
}

/** A point in CSS pixels inside the page, for `clickAt`. */
export interface TestingPointArgs extends TestingArgs {
	x: number;
	y: number;
}

/** `type` names a field to focus and the text to put in it. */
export interface TestingTypeArgs extends TestingSelectorArgs {
	text: string;
}

/** `key` sends one key, with the modifiers a real chord would carry. */
export interface TestingKeyArgs extends TestingArgs {
	key: string;
	modifiers?: TestingModifiers;
}

export interface TestingModifiers {
	alt?: boolean;
	ctrl?: boolean;
	meta?: boolean;
	shift?: boolean;
}

/** `waitFor` polls until the selector exists, then answers; a timeout is `not-found`. */
export interface TestingWaitArgs extends TestingSelectorArgs {
	timeoutMs?: number;
}

/** `console` reads the page's captured entries; `since` is a millisecond timestamp. */
export interface TestingConsoleArgs extends TestingArgs {
	since?: number;
}

export interface ClickedResult {
	readonly ok: true;
	readonly clicked: true;
}

export interface HoveredResult {
	readonly ok: true;
	readonly hovered: true;
}

/** What the field holds after `type` — read back, never assumed. */
export interface TypedResult {
	readonly ok: true;
	readonly value: string;
}

export interface KeyResult {
	readonly ok: true;
	readonly key: string;
	readonly modifiers: Required<TestingModifiers>;
	/** The tag the event was dispatched on: the focused element, or `body` when nothing is. */
	readonly target: string;
}

/** The page as `query` reads it: presence, visibility, geometry, text, value and attributes. */
export interface QueryResult {
	readonly ok: true;
	readonly exists: boolean;
	readonly visible: boolean;
	readonly rect: { x: number; y: number; width: number; height: number };
	readonly text: string;
	/** `null` when the element has no value at all, so `""` stays distinguishable. */
	readonly value: string | null;
	readonly attributes: Record<string, string>;
}

export interface WaitResult {
	readonly ok: true;
	readonly found: true;
	readonly waitedMs: number;
}

/** One captured console line, as the page tap recorded it. */
export interface ConsoleEntry {
	readonly level: string;
	readonly args: readonly string[];
	readonly at: number;
}

export interface ConsoleResult {
	readonly ok: true;
	/** False when the page-world tap is absent: the caller learns why instead of reading `[]`. */
	readonly hooked: boolean;
	readonly entries: readonly ConsoleEntry[];
}

/** What the page's own script answers: a JSON string of one of these shapes. */
export type PageAnswer =
	| ClickedResult
	| HoveredResult
	| TypedResult
	| KeyResult
	| QueryResult
	| ConsoleResult
	| TestingFailure;

/** The namespace's command map, so a caller reads `commands.query` as a command rather than an index. */
export interface TestingCommands extends CommandMap {
	click: (args: TestingSelectorArgs) => Promise<ClickedResult | TestingFailure | NotImplemented>;
	clickAt: (args: TestingPointArgs) => Promise<ClickedResult | TestingFailure | NotImplemented>;
	type: (args: TestingTypeArgs) => Promise<TypedResult | TestingFailure | NotImplemented>;
	key: (args: TestingKeyArgs) => Promise<KeyResult | TestingFailure | NotImplemented>;
	hover: (args: TestingSelectorArgs) => Promise<HoveredResult | TestingFailure | NotImplemented>;
	query: (args: TestingSelectorArgs) => Promise<QueryResult | TestingFailure | NotImplemented>;
	waitFor: (args: TestingWaitArgs) => Promise<WaitResult | TestingFailure | NotImplemented>;
	console: (args: TestingConsoleArgs) => Promise<ConsoleResult | TestingFailure | NotImplemented>;
}
