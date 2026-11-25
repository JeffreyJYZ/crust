/**
 * The chrome adapter's own rules, with the sends replaced by a double: a style-mask change re-applies the frame AppKit moved and proves it took, a frame that cannot be read is refused before the mask is touched, and an opacity that did not apply is an error. No AppKit, no window, and the cursor is only ever a recorded call — nothing here hides a real pointer.
 */

import { describe, expect, test } from "bun:test";
import { WindowAdapterError } from "@/plugins/window";
import { windowChromeAdapter } from "./window-chrome-adapter.ts";
import { type WindowChromeSends, CURSOR_SELECTOR } from "./window-chrome.ts";
import type { WindowFrame } from "./window-state.ts";

const START: WindowFrame = { x: 10, y: 20, width: 800, height: 600 };

/**
 * A window whose `setStyleMask:` moves the frame by `jump` points, the way
 * AppKit grows a window upward when a title bar is added.
 */
function double(options: { frame?: WindowFrame; jump?: number; ignoreRestore?: boolean } = {}): {
	adapter: ReturnType<typeof windowChromeAdapter>;
	calls: string[];
	frame: () => WindowFrame;
	mask: () => number;
} {
	const calls: string[] = [];
	let frame: WindowFrame = { ...(options.frame ?? START) };
	const jump = options.jump ?? 28;
	let mask = 0b1111; // titled, closable, miniaturizable, resizable
	let alpha = 1;
	const sends: WindowChromeSends = {
		frame: () => ({ ...frame }),
		setFrame: (_win, next) => {
			calls.push(`setFrame:${next.x},${next.y},${next.width},${next.height}`);
			if (options.ignoreRestore) return;
			frame = { ...next };
		},
		styleMask: () => mask,
		setStyleMask: (_win, next) => {
			calls.push(`setStyleMask:${next}`);
			mask = next;
			frame = { ...frame, height: frame.height + jump };
		},
		opacity: () => alpha,
		setOpacity: (_win, value) => {
			calls.push(`setOpacity:${value}`);
			alpha = value;
		},
		cursor: (cursor) => {
			calls.push(`cursor:${cursor}`);
		},
		cursorVisible: (visible) => {
			calls.push(`cursorVisible:${visible}`);
		},
	};
	const require = (label: string): number => {
		if (label !== "main") {
			throw new WindowAdapterError("unknown-window", `no window labelled ${label}`);
		}
		return 1;
	};
	return {
		adapter: windowChromeAdapter(require, sends),
		calls,
		frame: () => ({ ...frame }),
		mask: () => mask,
	};
}

describe("decorations", () => {
	test("removing the title bar re-applies the frame AppKit moved", () => {
		const { adapter, calls, frame, mask } = double();

		adapter.setDecorations?.("main", false);

		expect(mask()).toBe(0b1000);
		// The frame is put back exactly, and the read-back proves it took.
		expect(frame()).toEqual(START);
		expect(calls).toEqual(["setStyleMask:8", "setFrame:10,20,800,600"]);
		expect(adapter.isDecorated?.("main")).toBe(false);
	});

	test("restoring the title bar does the same in the other direction", () => {
		const { adapter, calls, frame, mask } = double();
		adapter.setDecorations?.("main", false);
		calls.length = 0;

		adapter.setDecorations?.("main", true);

		expect(mask()).toBe(0b1111);
		expect(frame()).toEqual(START);
		expect(calls).toEqual(["setStyleMask:15", "setFrame:10,20,800,600"]);
		expect(adapter.isDecorated?.("main")).toBe(true);
	});

	test("a mask already in the asked-for state sends nothing", () => {
		const { adapter, calls } = double();

		adapter.setDecorations?.("main", true);
		expect(calls).toEqual([]);
		expect(adapter.isDecorated?.("main")).toBe(true);
	});

	test("a frame AppKit did not move costs no setFrame:", () => {
		const { adapter, calls } = double({ jump: 0 });

		adapter.setDecorations?.("main", false);
		expect(calls).toEqual(["setStyleMask:8"]);
	});

	test("a frame that cannot be read is refused before the mask is touched", () => {
		const { adapter, calls } = double({ frame: { x: 0, y: 0, width: 0, height: 0 } });

		expect(() => adapter.setDecorations?.("main", false)).toThrow(/could not be read/);
		expect(() => adapter.setDecorations?.("main", false)).toThrow(WindowAdapterError);
		// Nothing was sent, so the window still has its title bar and its size.
		expect(calls).toEqual([]);
	});

	test("a frame that did not come back is an error, not a silent success", () => {
		const { adapter } = double({ ignoreRestore: true });

		expect(() => adapter.setDecorations?.("main", false)).toThrow(/was not restored/);
	});

	test("an unknown label is refused, not sent", () => {
		const { adapter, calls } = double();

		expect(() => adapter.isDecorated?.("ghost")).toThrow(WindowAdapterError);
		expect(() => adapter.setDecorations?.("ghost", false)).toThrow(/no window labelled/);
		expect(calls).toEqual([]);
	});
});

describe("opacity and the pointer", () => {
	test("opacity is read back, so a value AppKit ignored is an error", () => {
		const { adapter, calls } = double();

		expect(adapter.opacity?.("main")).toBe(1);
		adapter.setOpacity?.("main", 0.25);
		expect(adapter.opacity?.("main")).toBe(0.25);
		expect(calls).toEqual(["setOpacity:0.25"]);
	});

	test("every cursor name maps to its NSCursor class method", () => {
		expect(CURSOR_SELECTOR).toEqual({
			default: "arrowCursor",
			pointer: "pointingHandCursor",
			crosshair: "crosshairCursor",
			text: "IBeamCursor",
			grab: "openHandCursor",
		});
	});

	test("the pointer commands reach the sends and take no label", () => {
		const { adapter, calls } = double();

		adapter.setCursor?.("grab");
		adapter.setCursorVisible?.(false);
		adapter.setCursorVisible?.(true);

		expect(calls).toEqual(["cursor:grab", "cursorVisible:false", "cursorVisible:true"]);
	});

	test("a repeated setCursorVisible sends nothing, keeping the hide counter balanced", () => {
		const { adapter, calls } = double();

		adapter.setCursorVisible?.(false);
		adapter.setCursorVisible?.(false);
		adapter.setCursorVisible?.(true);

		expect(calls).toEqual(["cursorVisible:false", "cursorVisible:true"]);
	});
});
