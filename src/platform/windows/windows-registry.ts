/**
 * The windows a Windows platform tracks. Unlike AppKit, Win32 answers liveness with one call —
 * `IsWindow` returns 0 once the handle is destroyed — so a closed label prunes on read instead of
 * being kept addressable, and nothing here needs a visibility/minimised/hidden-app triple.
 */
import type { WindowHandle } from "@/app.ts";
import type { WindowsShim } from "./backend.ts";

export interface TrackedWindow {
	handle: WindowHandle;
	hwnd: number;
	/** The absolute URL this window was asked to load; a later relative URL resolves against it. */
	url: string;
}

export class WindowsRegistry {
	readonly #windows = new Map<string, TrackedWindow>();
	/** Arrives after `start()`; before it no window can exist, so nothing prunes. */
	#shim: WindowsShim | undefined;

	/** Hand the registry the compiled shim, so liveness can be read. */
	attach(shim: WindowsShim | undefined): void {
		this.#shim = shim;
	}

	/** Whether this label is tracked at all, open or closed. */
	has(label: string): boolean {
		return this.#windows.has(label);
	}

	/** Start tracking a freshly created window. */
	set(entry: TrackedWindow): void {
		this.#windows.set(entry.handle.label, entry);
	}

	/** The tracked window while it is still open; a closed label is pruned on read. */
	get(label: string): TrackedWindow | undefined {
		const entry = this.#windows.get(label);
		if (!entry) return undefined;
		if (!this.isOpen(entry.hwnd)) {
			this.#windows.delete(label);
			return undefined;
		}
		return entry;
	}

	/** The labels still open, in creation order. */
	labels(): string[] {
		return [...this.#windows.entries()]
			.filter(([, entry]) => this.isOpen(entry.hwnd))
			.map(([label]) => label);
	}

	/** Every tracked window, closed ones included, for `quit()`'s teardown. */
	entries(): TrackedWindow[] {
		return [...this.#windows.values()];
	}

	/** Drop every entry; `quit()` owns the native destruction that makes this true. */
	clear(): void {
		this.#windows.clear();
	}

	/** Whether Win32 still holds this window. A missing shim means nothing was created yet. */
	isOpen(hwnd: number): boolean {
		const shim = this.#shim;
		if (!shim) return true;
		return Number(shim.shim_window_is_open(hwnd)) === 1;
	}
}
