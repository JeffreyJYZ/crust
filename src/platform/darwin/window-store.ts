/**
 * The slice of a window registry the Darwin platform drives, plus the close verb the shared `Platform`
 * seam needs. Split from `platform.ts` so that file stays under the line cap; the default wraps the
 * real `WindowRegistry`, and a test injects a fake with the same shape without starting AppKit.
 */
import type { WindowHandle } from "@/app.ts";
import { S } from "./objc.ts";
import { type NativeWindowPointers, WindowRegistry } from "./windows.ts";

/** Everything `DarwinPlatform` asks of its windows, including closing exactly one of them. */
export interface DarwinWindowStore {
	has(label: string): boolean;
	track(handle: WindowHandle, pointers: NativeWindowPointers): void;
	handle(label: string): WindowHandle | undefined;
	labels(): string[];
	url(label: string): string | undefined;
	native(label: string): number | undefined;
	webview(label: string): number | undefined;
	number(label: string): number | undefined;
	destroy(label: string): void;
}

/**
 * The real store. `-close` orders the window out and removes it from `-[NSApplication windows]`;
 * the registry's own liveness read then prunes the label, so `window()` and `windowLabels()` both
 * forget it and the label can be created again. The explicit `handle(label)` forces that prune now
 * instead of waiting for the next caller.
 */
export function createWindowStore(app: () => number): DarwinWindowStore {
	const registry = new WindowRegistry(app);
	return {
		has: (label) => registry.has(label),
		track: (handle, pointers) => registry.track(handle, pointers),
		handle: (label) => registry.handle(label),
		labels: () => registry.labels(),
		url: (label) => registry.url(label),
		native: (label) => registry.native(label),
		webview: (label) => registry.webview(label),
		number: (label) => registry.number(label),
		destroy(label) {
			const win = registry.native(label);
			if (win === undefined) return;
			S.v0(win, "close");
			registry.handle(label);
		},
	};
}
