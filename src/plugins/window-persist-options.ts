/**
 * `window-state`'s public vocabulary: the platform adapter it drives, the typed answers its
 * commands give, and the options `createWindowStatePlugin` takes. Kept beside `window-persist.ts`
 * rather than inside it so the command wiring stays readable; `window-persist.ts` re-exports all of
 * it, so callers import one module.
 */

import type { FrameRect } from "./window-frame.ts";
import type { WindowFrame } from "./window-persist-store.ts";
import type { WindowPoint, WindowSize } from "./window-types.ts";

/**
 * The native half: `list` plus the four frame calls, optional exactly as `WindowStateNative` has them, so a platform adapter is passed straight in and a missing member answers `unknown-adapter` instead of failing to compile.
 */
export interface WindowFrameNative {
	list(): string[];
	/** The liveness oracle; a closed window is pruned from `list()` on macOS but still known here. */
	isOpen?(label: string): boolean;
	getSize?(label: string): WindowSize;
	getPosition?(label: string): WindowPoint;
	setSize?(label: string, size: WindowSize): void;
	setPosition?(label: string, position: WindowPoint): void;
}

export interface WindowStateSaveResult {
	ok: true;
	label: string;
	frame: WindowFrame;
}

export interface WindowStateRestoreResult {
	ok: true;
	label: string;
	/** False when no usable entry existed; that is an answer, not a failure. */
	restored: boolean;
	frame?: WindowFrame;
}

export interface WindowStateForgetResult {
	ok: true;
	label: string;
	removed: boolean;
}

export interface WindowStateOptions {
	/** The platform's frame calls; absent answers `not-implemented`, as `crust:window` does. */
	native?: WindowFrameNative;
	/** Directory holding the state file. Defaults to `defaultStateRoot(app)`. */
	root?: string;
	/** App name for the default root, usually the config's `app.name`. */
	app?: string;
	/**
	 * Every display's work area, in the coordinate space the frame calls report and apply. Supplying
	 * it turns on the automatic half: a `crust dev` run restores a saved frame at window create and
	 * saves a changed one, both through this plugin's own adapter. Without it — or without the dev
	 * runner's directory — nothing is restored or written, which is what a built app gets.
	 */
	workAreas?: () => readonly FrameRect[];
}
