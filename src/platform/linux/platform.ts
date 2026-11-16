/**
 * The Linux `Platform`: GTK's lifecycle and the pump, with every native call behind an injected backend so the class is testable on a machine that has no GTK.
 * UNPROVEN ON REAL GTK: this layer was written on macOS, where neither library exists, so the FFI path has never run against a display server. What is proven is the shape — the five methods, the pump interval, the preflight text and the guarded load.
 */
import type { Platform, WindowHandle, WindowOptions } from "@/app.ts";
import type { CrustConfig } from "@/config";
import { createGtkBackend, type LinuxBackend, type NativeWindow } from "./backend.ts";

/**
 * The Linux `Platform`. Construct through `createPlatform()`; the class is
 * exported because the pump and its timer are testable with a fake backend.
 */
export class LinuxPlatform implements Platform {
	readonly #backend: LinuxBackend;
	readonly #windows = new Map<string, NativeWindow & { handle: WindowHandle }>();
	#started = false;
	#pumping = false;
	#pumpTimer: ReturnType<typeof setTimeout> | undefined;
	#ticks = 0;
	#quit = false;

	constructor(backend: LinuxBackend) {
		this.#backend = backend;
	}

	/**
	 * Bring GTK up. It does not create windows — `openWindows` in `src/app-loop.ts`
	 * is the single place a configured window is created — and it registers no URI
	 * scheme, because every platform loads the page from the URL the window was
	 * created with.
	 */
	async start(): Promise<void> {
		if (this.#started) return;
		// A load failure is the preflight text, thrown so a launch names what is
		// missing instead of leaving a black window; `#started` stays false so a
		// caller may retry once the library is installed.
		this.#backend.load();
		this.#started = true;
	}

	/**
	 * Pump GTK from a self-rearming `setTimeout` chain, the same shape as the
	 * darwin pump: Bun owns the thread, so the main context is iterated once per
	 * tick and never blocks.
	 */
	pump(intervalMs: number): void {
		if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
			throw new Error(`pump: intervalMs must be a positive number, got ${intervalMs}`);
		}
		if (this.#pumping) this.stopPump();
		this.#pumping = true;
		const tick = () => {
			if (!this.#pumping) return;
			this.#backend.iterate();
			this.#ticks++;
			this.#pumpTimer = setTimeout(tick, intervalMs);
		};
		tick();
	}

	/** Stop the pump timer. `quit()` calls this; tests call it directly. */
	stopPump(): void {
		this.#pumping = false;
		if (this.#pumpTimer !== undefined) clearTimeout(this.#pumpTimer);
		this.#pumpTimer = undefined;
	}

	/** Whether a pump timer is currently armed. */
	get pumping(): boolean {
		return this.#pumping;
	}

	/** How many slices this pump has run. Used by the timer test. */
	get ticks(): number {
		return this.#ticks;
	}

	/** Validate the label, build the window, then track it. */
	createWindow(options: WindowOptions): WindowHandle {
		const label = options.label;
		if (!label) throw new Error("createWindow: label must not be empty");
		if (this.#windows.has(label))
			throw new Error(`createWindow: window "${label}" already exists`);
		const native = this.#backend.createWindow(options, absoluteUrl(options.url ?? "/"));
		const handle: WindowHandle = { label };
		this.#windows.set(label, { handle, ...native });
		return handle;
	}

	/** The handle while the window is still open; a closed entry is pruned. */
	window(label: string): WindowHandle | undefined {
		const entry = this.#windows.get(label);
		if (!entry) return undefined;
		if (!this.#backend.isOpen(entry.win)) {
			this.#windows.delete(label);
			return undefined;
		}
		return entry.handle;
	}

	/** Stop the pump, then end the process once. A second call is a no-op. */
	quit(): void {
		if (this.#quit) return;
		this.#quit = true;
		this.stopPump();
		this.#backend.quit();
	}
}

/**
 * A GTK window takes an absolute URI; a relative one has no document to resolve
 * against and loads nothing, so it becomes `about:blank` — the darwin rule.
 */
function absoluteUrl(raw: string): string {
	return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : "about:blank";
}

/**
 * Build the Linux platform. `config` is accepted so all three platforms take the
 * same call from `loadPlatform`, and it is not read: GTK needs nothing from the
 * config before a window exists, and each window arrives with its own URL.
 */
export function createPlatform(
	config: CrustConfig,
	backend: LinuxBackend = createGtkBackend(),
): LinuxPlatform {
	return new LinuxPlatform(backend);
}
