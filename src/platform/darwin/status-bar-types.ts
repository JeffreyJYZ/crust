/**
 * The shapes `status-bar.ts` hands out: a menu entry, what AppKit reports, and
 * the live item the tray plugin and the tray probe both drive.
 *
 * Types only, so the item implementation and its readback can be read without
 * the FFI table in between.
 */

export interface StatusBarMenuItem {
	label: string;
	onClick?: () => void;
}

/**
 * What AppKit reports about the live item. Every field is a primitive the C
 * unit read back, so this is evidence of *state* and never of drawing: an item
 * can be `visible: true` with a `windowNumber` and still be on a hidden menu
 * bar (a fullscreen space), which is why a screenshot is reported beside it.
 */
export interface StatusBarReadback {
	/** The applied title, read out of the item. */
	title: string;
	/** `-[NSStatusItem isVisible]`; null when this AppKit has no such selector. */
	visible: boolean | null;
	/** `-[NSStatusItem length]` in points; null when absent. */
	length: number | null;
	/** The button window's number, the id `screencapture -l` takes; 0 when none. */
	windowNumber: number;
	/** `-[NSWindow isVisible]` for that button window; null when there is none. */
	windowVisible: boolean | null;
	/** The button window's frame in screen points, origin bottom-left; null when none. */
	frame: { x: number; y: number; width: number; height: number } | null;
	/** Raw `-[NSWindow occlusionState]`; bit 2 means the WindowServer composites it. */
	occlusion: number | null;
	/** `-[NSWindow isOnActiveSpace]`; null when absent. */
	onActiveSpace: boolean | null;
}

export interface StatusBar {
	/** Replace the text beside the icon. Empty is legal and shows no text. */
	setTitle(text: string): void;
	/** Put the item back on the menu bar. */
	show(): void;
	/** Take the item off the menu bar; it stays alive. */
	hide(): void;
	/** Replace the whole menu. An empty list detaches it. */
	setMenu(items: readonly StatusBarMenuItem[]): void;
	/** Remove the item from the status bar. A second call is a no-op. */
	destroy(): void;
	/** What AppKit reports about the item right now. State, not pixels. */
	readback(): StatusBarReadback;
	/**
	 * Fire a row through AppKit's own target/action, exactly as a click does.
	 *
	 * A test seam, not an input synthesizer: it never moves the cursor. It answers whether
	 * the row wiring and the click trampoline work, which is otherwise only provable by a
	 * human click on an item macOS may have hidden behind the notch.
	 */
	activateRow(index: number): boolean;
}
