/**
 * The app surface's types, kept apart from the class so `app.ts` reads as the lifecycle it is. `Platform` is the whole native surface crust depends on, one implementation per OS; `app.ts` re-exports every name here.
 */

import type { CrustConfig } from "@/config";
import type { BridgeTarget } from "@/bridge/server.ts";
import { CrustError } from "@/bridge/errors";

/** Where a window points and how it is sized. Mirrors a config window entry. */
export interface WindowOptions {
	label: string;
	url?: string;
	width?: number;
	height?: number;
	minWidth?: number;
	title?: string;
}

/** A created window. The label is what `Platform.window(label)` looks it up by. */
export interface WindowHandle {
	label: string;
}

/**
 * The whole native surface crust depends on, one implementation per OS: `start` brings up the application, `pump` runs the Cocoa run loop on a timer, `createWindow` opens a window, `window` returns it or undefined once closed, `quit` ends the application.
 */
export interface Platform {
	start(): Promise<void>;
	pump(intervalMs: number): void;
	createWindow(options: WindowOptions): WindowHandle;
	window(label: string): WindowHandle | undefined;
	quit(): void;
	/**
	 * Every label the platform still holds open. Optional because it is the honest answer to "is
	 * anything still on screen": `window.create` opens windows under labels the config never names,
	 * so a platform that omits this is watched by its config windows only.
	 */
	windowLabels?(): string[];
	/**
	 * Optional source of lifecycle events the native side observes (activate,
	 * before/will quit, reopen). A platform with no such concept omits this, or
	 * returns `unsupportedLifecycle(...)`, so no event is ever faked.
	 */
	lifecycle?(): LifecycleSource;
}

export type AppEvent =
	"ready" | "window-all-closed" | "activate" | "before-quit" | "will-quit" | "reopen";
export type AppListener = () => void | Promise<void>;
export type CommandHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

/**
 * A drainable queue of native lifecycle events. `take` returns every event
 * recorded since the last call; `settle` answers a deferred `before-quit` once
 * its listeners have run, so the native side can finish terminating.
 */
export interface LifecycleSource {
	take(): AppEvent[];
	settle?(): void;
}

/** An honest answer for a platform with no lifecycle notifications to bridge. */
export function unsupportedLifecycle(requires: string): LifecycleSource {
	return {
		take: () => {
			throw new CrustError(
				"not-implemented",
				`crust: lifecycle events need ${requires}, which this platform does not provide`,
			);
		},
	};
}

/**
 * The namespace a two-argument `window.crust.invoke(name, args)` is rewritten
 * into by the shim `startApp` injects. Reserved: no project plugin may claim it.
 */
export const APP_NAMESPACE = "app";

/**
 * Builds the bridge on demand and returns where its pages load from plus the credential they must
 * present. A bare URL is not enough: the document route refuses a request that cannot prove it was
 * sent to a window the app opened, so the caller needs the token as well as the address.
 */
export type BridgeFactory = (config: CrustConfig) => BridgeTarget;

/** Cocoa pump tick, from `site/app/docs/design/page.mdx`: a 16 ms tick with a 0.25 ms slice holds. */
export const PUMP_INTERVAL_MS = 16;
