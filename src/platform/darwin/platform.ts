/**
 * The macOS `Platform`: AppKit's lifecycle and the pump, with window
 * construction and tracking in their own modules.
 */
import type { LifecycleSource, Platform, WindowHandle, WindowOptions } from "@/app.ts";
import { type Activation, activateAppOnce } from "./activation.ts";
import { startAppKit } from "./appkit.ts";
import { bindBrowserWindows } from "./browser-platform.ts";
import { darwinLifecycleSource } from "./lifecycle.ts";
import { shim } from "./index.ts";
import { applyDockIcon } from "./dock-icon.ts";
import { ptrValue, S } from "./objc.ts";
import type { DarwinOptions } from "./platform-options.ts";
import { createPump } from "./pump.ts";
import { previewOwnerCheck } from "./preview.ts";
import { createNativeWindow } from "./window-create.ts";
import { type DarwinWindowStore, createWindowStore } from "./window-store.ts";

/** The macOS `Platform`: the pump and its timer are testable without a window. */
export class DarwinPlatform implements Platform {
	readonly #appName: string;
	#app = 0;
	/** `app.icon`, applied to the dock so a dev launch and a built app look the same. */
	readonly #icon: string | undefined;
	/** `app.activate`: when a window create may bring the app forward. */
	#activateMode: Activation["mode"];
	readonly #microphone: boolean;
	#mode = 0;
	#started = false;
	/** The pump timer and its per-tick preview poll; `pump.ts` owns the re-arming chain. */
	readonly #pump = createPump({ beforeTick: previewOwnerCheck });
	readonly #windows: DarwinWindowStore;

	constructor(options: DarwinOptions = {}, windows?: DarwinWindowStore) {
		this.#appName = options.appName ?? "crust";
		this.#activateMode = options.activate ?? "always";
		this.#icon = options.icon;
		this.#microphone = options.microphone === true;
		this.#windows = windows ?? createWindowStore(() => this.#app);
		// `featurePlugins` builds the browser plugin before the darwin arm of `runtime-plugins.ts`
		// is reached, so the surface looks its host windows up through this one registration.
		bindBrowserWindows(this);
	}

	/**
	 * Compile the shim, preflight every selector, then bring AppKit up in the
	 * measured order: NSApplicationLoad → sharedApplication → policy.
	 */
	async start(): Promise<void> {
		if (this.#started) return;
		shim();
		this.#app = startAppKit(this.#appName);
		this.ensureRunLoopMode();
		this.#started = true;
		// The packaged `.app` carries `app.icon` in its plist; `crust dev` had nothing, so the same app
		// showed the generic dock icon. Applied here, after AppKit is up and the tile is live.
		applyDockIcon(this.#icon);
		// Recorded because an inactive app is one macOS will not let you click into, and an
		// unbundled `crust dev` runtime is exactly the case where activation is refused.
		try {
			console.log(`  active    ${S.b0(this.#app ?? 0, "isActive") ? "yes" : "no"}`);
			console.log(
				`  runloop   main thread owns it: ${Number(shim().symbols.shim_on_main_runloop() ?? -1) === 1 ? "yes" : "no"}`,
			);
		} catch {
			// Diagnostics only.
		}
	}

	/** Pump Cocoa from a self-rearming chain; the timer, its validation and its poll live in `pump.ts`. */
	pump(intervalMs: number): void {
		this.ensureRunLoopMode();
		this.#pump.start(intervalMs, () => shim().symbols.shim_pump(this.#mode));
	}

	/** Stop the pump timer. `quit()` calls this; tests call it directly. */
	stopPump(): void {
		this.#pump.stop();
	}

	get pumping(): boolean {
		return this.#pump.pumping;
	}

	get ticks(): number {
		return this.#pump.ticks;
	}

	/** Validate the label, build the native window, then track it; `createNativeWindow` owns the AppKit ordering traps. */
	createWindow(options: WindowOptions): WindowHandle {
		const label = options.label;
		if (!label) throw new Error("createWindow: label must not be empty");
		if (this.#windows.has(label))
			throw new Error(`createWindow: window "${label}" already exists`);

		const handle: WindowHandle = { label };
		const activation: Activation = {
			mode: this.#activateMode,
			once: () => this.activateOnce(),
		};
		const pointers = createNativeWindow(label, options, activation, this.#microphone);
		this.#windows.track(handle, pointers);
		return handle;
	}

	/** The `app.activate` policy this platform runs under; `always` when the config omits it. */
	get activateMode(): Activation["mode"] {
		return this.#activateMode;
	}

	/** The absolute URL a tracked window was asked to load. */
	windowUrl(label: string): string | undefined {
		return this.#windows.url(label);
	}

	/** The handle while the window is still open; closed entries are pruned. */
	window(label: string): WindowHandle | undefined {
		return this.#windows.handle(label);
	}

	/** The labels this platform still tracks, in creation order. */
	windowLabels(): string[] {
		return this.#windows.labels();
	}

	destroy(label: string): void {
		this.#windows.destroy(label);
	}

	/** Lifecycle events recorded by the app delegate deep-link already installs. */
	lifecycle(): LifecycleSource {
		return darwinLifecycleSource();
	}

	/** The native `NSWindow *` behind a tracked label; undefined when never created. */
	nativeWindow(label: string): number | undefined {
		return this.#windows.native(label);
	}

	/**
	 * The `WKWebView *` behind a tracked label while the window is open; undefined when the
	 * label was never created or the window has closed. What a native surface resolves a
	 * command's `label` against, so it acts on that window rather than the first one.
	 */
	webview(label: string): number | undefined {
		return this.#windows.webview(label);
	}

	/** The window device number while open, 0 once closed, undefined when unknown. */
	windowNumber(label: string): number | undefined {
		return this.#windows.number(label);
	}

	/** Activate the app at most once per process; a failure is cosmetic and never loses a window. */
	activateOnce(): void {
		activateAppOnce(this.#app);
	}

	/** Stop the pump, close every window through `destroy`, mark the quit deliberate, then leave. */
	quit(): void {
		this.stopPump();
		for (const label of this.#windows.labels()) this.destroy(label);
		// `-terminate:` runs `applicationShouldTerminate:`, which defers with NSTerminateLater when a
		// before-quit watcher exists — right for a user's ⌘Q, wrong here: this path IS the decision, and
		// deferring spins a nested run loop for a reply nothing sends (a windowless process alive 40 s).
		try {
			this.lifecycle().immediate?.();
		} catch {
			// A platform without the C unit has nothing to tell.
		}
		if (this.#app) {
			try {
				S.v1(this.#app, "terminate:", 0);
			} catch {
				// terminate: can close windows re-entrantly; process.exit is still next.
			}
		}
		process.exit(0);
	}

	/** The verified `kCFRunLoopDefaultMode` CFString, resolved once. */
	private ensureRunLoopMode(): void {
		if (this.#mode) return;
		const mode = ptrValue(shim().symbols.shim_mode(), "shim_mode");
		const ok = Number(shim().symbols.shim_mode_ok(mode) ?? 0) === 1;
		if (!ok) throw new Error("run loop mode did not verify — a wrong mode is a silent no-op");
		this.#mode = mode;
	}
}

/** `createPlatform` lives in `platform-factory.ts`; re-exported so every caller keeps its import. */
export { createPlatform } from "./platform-factory.ts";
