/**
 * The Linux `Platform`: GTK's lifecycle and the pump, with every native call behind an injected backend so the class is testable on a machine that has no GTK.
 * UNPROVEN ON REAL GTK: this layer was written on macOS, where neither library exists, so the FFI path has never run against a display server. What is proven is the shape — the five methods, the pump interval, the preflight text and the guarded load.
 */
import type { Platform, WindowHandle, WindowOptions } from "@/app.ts";
import { unsupportedLifecycle } from "@/app-types.ts";
import type { CrustConfig } from "@/config";
import { setActiveLinuxPlatform } from "./active-platform.ts";
import { createGtkBackend, type LinuxBackend, type NativeWindow } from "./backend.ts";
import { pollTrayTick } from "./tray-tick.ts";

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
			// A JS timer firing is not proof GTK ran. Count only the iterations the
			// native pump reports, so `ticks` means what the smoke's detail says.
			if (this.#backend.iterate()) this.#ticks++;
			// A tray click is recorded by GTK's `activate` signal and reaches JavaScript only here,
			// so a slice that skips this records a click nobody hears. One int read, no second loop.
			pollTrayTick();
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

	/**
	 * Every label whose window is still open, pruned the same way `window()` prunes: the all-closed
	 * check reads this, so a page-created window keeps the app alive on Linux exactly as it does on
	 * macOS and Windows.
	 */
	windowLabels(): string[] {
		const live: string[] = [];
		for (const [label, entry] of this.#windows) {
			if (this.#backend.isOpen(entry.win)) live.push(label);
			else this.#windows.delete(label);
		}
		return live.sort();
	}

	/**
	 * The tracked native window behind a label, for the `crust:window` adapter: the same map
	 * `window()` reads, pruned the same way, so there is one answer to "which window is this
	 * label". `win` is a `GtkWindow *` that GTK still holds — a destroyed widget is freed, so a
	 * stale pointer never leaves here — and `url` is the document it was created with, which is
	 * what a relative `window.create` resolves against.
	 */
	nativeWindow(label: string): NativeWindow | undefined {
		const entry = this.#windows.get(label);
		if (!entry) return undefined;
		if (!this.#backend.isOpen(entry.win)) {
			this.#windows.delete(label);
			return undefined;
		}
		return { win: entry.win, web: entry.web, box: entry.box, url: entry.url };
	}

	/**
	 * Close one tracked window through GTK and forget its label; every other window stays open.
	 * Unknown labels are a no-op. This is the shared `Platform.destroy` seam.
	 */
	destroy(label: string): void {
		const entry = this.#windows.get(label);
		if (!entry) return;
		this.#backend.destroy(entry.win);
		this.#windows.delete(label);
	}

	/**
	 * Stop the pump, close every window through `destroy` — the production caller
	 * for the native `shim_window_destroy` — then end the process once. A second
	 * call is a no-op.
	 */
	quit(): void {
		if (this.#quit) return;
		this.#quit = true;
		this.stopPump();
		for (const label of [...this.#windows.keys()]) this.destroy(label);
		this.#backend.quit();
	}

	/**
	 * GTK focus events are not bridged: no `activate`/quit/reopen listener can be
	 * woken honestly here. Answer `not-implemented` naming the concept rather than
	 * emitting a listener that would never fire.
	 */
	lifecycle(): ReturnType<typeof unsupportedLifecycle> {
		return unsupportedLifecycle("GTK window focus and delete-event notifications");
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
	const platform = new LinuxPlatform(backend);
	// The registry picks the window adapter by OS and receives only the darwin platform, so this
	// instance registers itself where the Linux arm looks; see `active-platform.ts`.
	setActiveLinuxPlatform({ platform });
	return platform;
}
