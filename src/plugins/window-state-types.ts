/**
 * `crust:window`'s state vocabulary: the geometry and flag shapes `setSize` and friends exchange, and the optional adapter members they need. Split out of `window-types.ts` so the original six commands' contract stays one screen; `window-types.ts` re-exports all of it.
 */

/** A window size in points, as a page asks for it and as it reads back. */
export interface WindowSize {
	width: number;
	height: number;
}

/**
 * A screen origin in AppKit's bottom-left coordinates. Negative is legitimate:
 * a second display sits left of or below the main one.
 */
export interface WindowPoint {
	x: number;
	y: number;
}

export interface WindowSetSizeArgs extends WindowSize {
	label: string;
}

export interface WindowSetPositionArgs extends WindowPoint {
	label: string;
}

export interface WindowFlagArgs {
	label: string;
	value: boolean;
}

export interface WindowSizeResult extends WindowSize {
	readonly ok: true;
	readonly label: string;
}

export interface WindowPositionResult extends WindowPoint {
	readonly ok: true;
	readonly label: string;
}

export interface WindowAlwaysOnTopResult {
	readonly ok: true;
	readonly label: string;
	readonly alwaysOnTop: boolean;
}

export interface WindowFullscreenResult {
	readonly ok: true;
	readonly label: string;
	readonly fullscreen: boolean;
}

export interface WindowMinimizedResult {
	readonly ok: true;
	readonly label: string;
	readonly minimized: boolean;
}

export interface WindowMaximizedResult {
	readonly ok: true;
	readonly label: string;
	readonly maximized: boolean;
}

/**
 * The state half of the native contract, every member optional: an adapter
 * written before these commands existed still satisfies `WindowNative`, and a
 * missing member answers `unknown-adapter` rather than failing to compile. Same
 * rule `create` set. The platform owns what the type cannot say — macOS resizes
 * the window frame, so the title bar is inside `setSize`'s number.
 */
export interface WindowStateNative {
	setSize?(label: string, size: WindowSize): void;
	getSize?(label: string): WindowSize;
	setPosition?(label: string, point: WindowPoint): void;
	getPosition?(label: string): WindowPoint;
	setAlwaysOnTop?(label: string, value: boolean): void;
	isAlwaysOnTop?(label: string): boolean;
	setFullscreen?(label: string, value: boolean): void;
	isFullscreen?(label: string): boolean;
	minimize?(label: string): void;
	unminimize?(label: string): void;
	isMinimized?(label: string): boolean;
	maximize?(label: string): void;
	isMaximized?(label: string): boolean;
}
