/**
 * The Windows `Platform`: one Win32 window and one WebView2 controller per label, pumped from Bun's
 * main thread because Bun owns the thread and Win32 will not dispatch without a message loop.
 * UNPROVEN ON WINDOWS — this file was written on macOS and has never run against user32, ole32 or
 * WebView2, so every ordering claim below is untested. The backend is injected, which is the only
 * reason the five methods can be tested at all.
 */
import type { Platform, WindowHandle, WindowOptions } from "@/app.ts";
import { unsupportedLifecycle } from "@/app-types.ts";
import { type WindowsBackend, type WindowsShim, defaultBackend } from "./backend.ts";
import { cstring } from "./cstring.ts";
import { destroyWindow } from "./destroy.ts";
import { type WindowsPlatformConfig, hresult } from "./platform-config.ts";
import { preflightError } from "./preflight.ts";
import { openWindow } from "./window-open.ts";
import { WindowsRegistry } from "./windows-registry.ts";

export class WindowsPlatform implements Platform {
	readonly #appName: string;
	readonly #userDataDir: string;
	readonly #backend: WindowsBackend;
	readonly #windows = new WindowsRegistry();
	#shim: WindowsShim | undefined;
	#started = false;
	#pumping = false;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#ticks = 0;
	/** Messages `shim_pump` actually dispatched; a JS timer alone cannot move this. */
	#nativeMessages = 0;
	#quit = false;
	#unavailable: string | undefined;

	constructor(config: WindowsPlatformConfig = {}, backend: WindowsBackend = defaultBackend()) {
		this.#appName = config.appName ?? "crust";
		this.#userDataDir = config.userDataDir ?? "";
		this.#backend = backend;
	}

	/** Why the platform cannot open a window, when it cannot; `undefined` on a ready machine. */
	get unavailable(): string | undefined {
		return this.#unavailable;
	}

	/** Whether `start()` has run, whether or not it found a usable machine. */
	get started(): boolean {
		return this.#started;
	}

	/** Whether a pump timer is armed. */
	get pumping(): boolean {
		return this.#pumping;
	}

	/** How many timer slices this pump has run. Used by the timer test. */
	get ticks(): number {
		return this.#ticks;
	}

	/** How many queued Win32 messages the native pump dispatched, summed across slices. */
	get nativeMessages(): number {
		return this.#nativeMessages;
	}

	/**
	 * Probe, then bring up COM and the window class. A machine without the WebView2 runtime is a
	 * supported state: `start()` resolves and reports, and `createWindow` throws the same text, so
	 * an app can print the install remedy instead of dying in a stack trace nobody can act on.
	 */
	async start(): Promise<void> {
		if (this.#started) return;
		this.#started = true;
		const missing = preflightError(this.#backend.probe());
		if (missing) {
			this.#unavailable = missing;
			console.log(missing);
			return;
		}
		const shim = this.#backend.load();
		// Every Win32 entry point is a pointer `12_win32.c` resolves at runtime, so a machine that
		// is missing one is a message here rather than a null call at the first window.
		if (!Number(shim.shim_win32_ready())) {
			this.#unavailable =
				"crust: the Win32 entry points did not resolve — user32, ole32 or kernel32 is missing an export this shim calls";
			console.log(this.#unavailable);
			return;
		}
		const hr = Number(shim.shim_com_init());
		// S_OK (0) and S_FALSE (1) both mean the apartment is usable; anything else is a machine
		// that cannot host COM, where a window would fail later with no cause attached.
		if (hr < 0) {
			this.#unavailable = `crust: CoInitializeEx failed (${hresult(hr)}) — WebView2 needs a single-threaded apartment`;
			console.log(this.#unavailable);
			return;
		}
		if (!Number(shim.shim_register_class(cstring(this.#appName)))) {
			this.#unavailable = `crust: RegisterClassExW("${this.#appName}") failed (GetLastError ${Number(shim.shim_last_error())})`;
			console.log(this.#unavailable);
			return;
		}
		this.#shim = shim;
		this.#windows.attach(shim);
	}

	/**
	 * Pump Win32 from a self-rearming `setTimeout` chain, the same shape as the darwin run-loop
	 * pump: a repeating interval is more likely to be coalesced under power saving, and Bun owns
	 * the thread, so the cadence has to come from its timer.
	 */
	pump(intervalMs: number): void {
		if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
			throw new Error(`pump: intervalMs must be a positive number, got ${intervalMs}`);
		}
		if (this.#pumping) this.stopPump();
		this.#pumping = true;
		const tick = () => {
			if (!this.#pumping) return;
			// A pump before `start()` has nothing to drain, but the counter still moves so the
			// shape is the same with or without a window.
			// The timer proves Bun ran, not Win32. Keep both: `ticks` is the cadence, and
			// `nativeMessages` is the only one a real-pump assertion may trust.
			this.#nativeMessages += Number(this.#shim?.shim_pump() ?? 0);
			this.#ticks++;
			this.#timer = setTimeout(tick, intervalMs);
		};
		tick();
	}

	/** Stop the pump timer. `quit()` calls this; tests call it directly. */
	stopPump(): void {
		this.#pumping = false;
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#timer = undefined;
	}

	/**
	 * Create the window and its controller. An already-tracked label returns its existing handle:
	 * a configured window is opened once, and the app's own window loop then asks for the same
	 * labels, which must not become a second native window.
	 */
	createWindow(options: WindowOptions): WindowHandle {
		const label = options.label;
		if (!label) throw new Error("createWindow: label must not be empty");
		const existing = this.#windows.get(label);
		if (existing) return existing.handle;
		if (this.#unavailable) throw new Error(this.#unavailable);
		const shim = this.#shim;
		if (!shim) throw new Error("createWindow: start() has not run");
		const { hwnd, url } = openWindow(shim, options, this.#appName, this.#userDataDir);
		const handle: WindowHandle = { label };
		this.#windows.set({ handle, hwnd, url });
		console.log(`  window    ${label} hwnd ${hwnd} ${url}`);
		return handle;
	}

	/** The handle while the window is still open; closed entries are pruned. */
	window(label: string): WindowHandle | undefined {
		return this.#windows.get(label)?.handle;
	}

	/** Close one window by label; its label is pruned once Win32 confirms the handle is gone. */
	destroy(label: string): void {
		destroyWindow(this.#windows, this.#shim, label);
	}

	/** The labels this platform still tracks, in creation order. */
	windowLabels(): string[] {
		return this.#windows.labels();
	}

	/** The native `HWND` behind a tracked label; undefined once closed or never created. */
	nativeWindow(label: string): number | undefined {
		return this.#windows.get(label)?.hwnd;
	}

	/** The absolute URL a tracked window was asked to load. */
	windowUrl(label: string): string | undefined {
		return this.#windows.get(label)?.url;
	}

	/** Stop the pump, tear every window down, post the quit, then leave. Idempotent. */
	quit(): void {
		if (this.#quit) return;
		this.#quit = true;
		this.stopPump();
		if (this.#shim) {
			for (const label of this.#windows.labels()) this.destroy(label);
			this.#shim.shim_post_quit();
		}
		this.#windows.clear();
		this.#backend.exit(0);
	}

	/** No `WM_ACTIVATEAPP` bridge — a listener here would never fire. */
	lifecycle(): ReturnType<typeof unsupportedLifecycle> {
		return unsupportedLifecycle("WM_ACTIVATEAPP and WM_QUERYENDSESSION messages");
	}
}

/** `createPlatform` lives in `platform-factory.ts`; re-exported so every caller keeps its import. */
export { createPlatform } from "./platform-factory.ts";
