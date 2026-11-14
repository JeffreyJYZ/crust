/**
 * The app surface's types, kept apart from the class so `app.ts` reads as the lifecycle it is. `Platform` is the whole native surface crust depends on, one implementation per OS; `app.ts` re-exports every name here.
 */

import type { CrustConfig } from "@/config";

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
}

export type AppEvent = "ready" | "window-all-closed";
export type AppListener = () => void | Promise<void>;
export type CommandHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

/**
 * The namespace a two-argument `window.crust.invoke(name, args)` is rewritten
 * into by the shim `startApp` injects. Reserved: no project plugin may claim it.
 */
export const APP_NAMESPACE = "app";

/** Builds the bridge on demand and returns the URL its pages load from. */
export type BridgeFactory = (config: CrustConfig) => string;

/** Cocoa pump tick, from `site/app/docs/design/page.mdx`: a 16 ms tick with a 0.25 ms slice holds. */
export const PUMP_INTERVAL_MS = 16;
