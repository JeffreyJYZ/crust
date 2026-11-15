/**
 * `crust:window`'s chrome vocabulary: the title bar, the opacity and the two pointer commands, plus the optional adapter members they need. Split out of `window-types.ts` so the original six commands' contract stays one screen; `window-types.ts` re-exports all of it.
 */

/**
 * The cursors a page may ask for. A closed list on purpose: each name maps to
 * exactly one `NSCursor` class method, so an unknown string is refused rather
 * than silently leaving the pointer alone.
 */
export const WINDOW_CURSORS = ["default", "pointer", "crosshair", "text", "grab"] as const;

export type WindowCursor = (typeof WINDOW_CURSORS)[number];

export interface WindowSetDecorationsArgs {
	label: string;
	value: boolean;
}

export interface WindowSetOpacityArgs {
	label: string;
	value: number;
}

export interface WindowCursorArgs {
	cursor: WindowCursor;
}

export interface WindowCursorVisibleArgs {
	value: boolean;
}

export interface WindowDecorationsResult {
	readonly ok: true;
	readonly label: string;
	readonly decorations: boolean;
}

export interface WindowOpacityResult {
	readonly ok: true;
	readonly label: string;
	readonly opacity: number;
}

export interface WindowCursorResult {
	readonly ok: true;
	readonly cursor: WindowCursor;
}

export interface WindowCursorVisibleResult {
	readonly ok: true;
	readonly visible: boolean;
}

/**
 * The chrome half of the native contract, every member optional on the same
 * rule `WindowStateNative` set: an adapter written before these commands existed
 * still satisfies `WindowNative`, and a missing member answers `unknown-adapter`.
 * The pointer pair takes no label — macOS has one cursor for the app, not one
 * per window — so both are process-wide, exactly as `+[NSCursor hide]` is.
 */
export interface WindowChromeNative {
	setDecorations?(label: string, value: boolean): void;
	isDecorated?(label: string): boolean;
	setOpacity?(label: string, value: number): void;
	opacity?(label: string): number;
	setCursor?(cursor: WindowCursor): void;
	setCursorVisible?(visible: boolean): void;
}
