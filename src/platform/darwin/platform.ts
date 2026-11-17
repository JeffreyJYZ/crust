/**
 * The macOS `Platform`: AppKit's lifecycle and the pump, with window
 * construction and tracking in their own modules.
 */
import type { LifecycleSource, Platform, WindowHandle, WindowOptions } from "@/app.ts";
import { type Activation, activateAppOnce } from "./activation.ts";
import { startAppKit } from "./appkit.ts";
import { darwinLifecycleSource } from "./lifecycle.ts";
import { shim } from "./index.ts";
import { applyDockIcon } from "./dock-icon.ts";
import { ptrValue, S } from "./objc.ts";
import { createNativeWindow } from "./window-create.ts";
import { WindowRegistry } from "./windows.ts";

/** The macOS `Platform`: the pump and its timer are testable without a window. */
export class DarwinPlatform implements Platform {
	readonly #appName: string;
	#app = 0;
	/** `app.icon`, applied to the dock so a dev launch and a built app look the same. */
	readonly #icon: string | undefined;
	/** `app.activate`: when a window create may bring the app forward. */
	#activateMode: Activation["mode"];
	#mode = 0;
	#started = false;
	#pumping = false;
	#pumpTimer: ReturnType<typeof setTimeout> | undefined;
	#ticks = 0;
	readonly #registry: WindowRegistry;

	constructor(
		options: { appName?: string; activate?: Activation["mode"]; icon?: string } = {},
	) {
		this.#appName = options.appName ?? "crust";
		this.#activateMode = options.activate ?? "always";
		this.#icon = options.icon;
		this.#registry = new WindowRegistry(() => this.#app);
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

	/** Pump Cocoa from a self-rearming `setTimeout` chain; a repeating interval coalesces under power saving. */
	pump(intervalMs: number): void {
		if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
			throw new Error(`pump: intervalMs must be a positive number, got ${intervalMs}`);
		}
		this.ensureRunLoopMode();
		if (this.#pumping) this.stopPump();
		this.#pumping = true;
		const tick = () => {
			if (!this.#pumping) return;
			shim().symbols.shim_pump(this.#mode);
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

	/** Validate the label, build the native window, then track it; `createNativeWindow` owns the AppKit ordering traps. */
	createWindow(options: WindowOptions): WindowHandle {
		const label = options.label;
		if (!label) throw new Error("createWindow: label must not be empty");
		if (this.#registry.has(label))
			throw new Error(`createWindow: window "${label}" already exists`);

		const handle: WindowHandle = { label };
		const activation: Activation = {
			mode: this.#activateMode,
			once: () => this.activateOnce(),
		};
		const pointers = createNativeWindow(label, options, activation);
		this.#registry.track(handle, pointers);
		return handle;
	}

	/** The `app.activate` policy this platform runs under; `always` when the config omits it. */
	get activateMode(): Activation["mode"] {
		return this.#activateMode;
	}

	/** The absolute URL a tracked window was asked to load. */
	windowUrl(label: string): string | undefined {
		return this.#registry.url(label);
	}

	/** The handle while the window is still open; closed entries are pruned. */
	window(label: string): WindowHandle | undefined {
		return this.#registry.handle(label);
	}

	/** The labels this platform still tracks, in creation order. */
	windowLabels(): string[] {
		return this.#registry.labels();
	}

	/** Lifecycle events recorded by the app delegate deep-link already installs. */
	lifecycle(): LifecycleSource {
		return darwinLifecycleSource();
	}

	/** The native `NSWindow *` behind a tracked label; undefined when never created. */
	nativeWindow(label: string): number | undefined {
		return this.#registry.native(label);
	}

	/**
	 * The `WKWebView *` behind a tracked label while the window is open; undefined when the
	 * label was never created or the window has closed. What a native surface resolves a
	 * command's `label` against, so it acts on that window rather than the first one.
	 */
	webview(label: string): number | undefined {
		return this.#registry.webview(label);
	}

	/** The window device number while open, 0 once closed, undefined when unknown. */
	windowNumber(label: string): number | undefined {
		return this.#registry.number(label);
	}

	/** Activate the app at most once per process; a failure is cosmetic and never loses a window. */
	activateOnce(): void {
		activateAppOnce(this.#app);
	}

	/** Stop the pump, ask AppKit to terminate, then leave. */
	quit(): void {
		this.stopPump();
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

/**
 * Build the macOS platform. `appName` names failures; `activate` is `app.activate` (`always` when
 * omitted — that is what puts a window in the accessibility tree); `icon` is `app.icon`.
 */
export function createPlatform(
	options: {
		appName?: string;
		activate?: Activation["mode"];
		icon?: string;
	} = {},
): DarwinPlatform {
	return new DarwinPlatform(options);
}
