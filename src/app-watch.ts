/**
 * The two watches an app run installs: one that notices every window is gone, and one that turns a
 * platform's lifecycle queue into `app.on` events. Split out of `app-loop.ts` when that file passed
 * the 200-line cap; the fix for a cap is another file, never a trimmed comment.
 */

import {
	type AppEvent,
	type AppListener,
	type LifecycleSource,
	type Platform,
} from "./app-types.ts";
import type { CrustConfig, WindowConfig } from "./config/index.ts";
import { emit } from "./app-loop.ts";

/** How often the lifecycle queue is drained. One tick is a cheap native call, not a poll of the OS. */
export const LIFECYCLE_CHECK_INTERVAL_MS = 250;

/** A page's event sink: the `ctx.emit` a bridge hands to one command handler. */
export type PageEventSink = (event: string, data: unknown) => void;

/**
 * Where `app:` events go on the page side. Module-level rather than a field on `App` because the
 * sink is a bridge handle's `emit`, which no `App` owns: `runtime.ts` builds the bridge and the
 * `app` namespace plugin is the only thing holding a `ctx.emit`, so the registry is the seam
 * between them. A process runs one bridge, so one set cannot go ambiguous — the same reasoning as
 * `window-identity.ts`'s recorded token.
 */
const pageSinks = new Set<PageEventSink>();

/**
 * Arm page delivery for `app:` events; the returned function disarms it.
 *
 * Idempotent by sink identity: a page calls `app.info()` on every render and the bridge hands it
 * the same `ctx.emit` each time, so without this the set would grow one entry per call.
 */
export function subscribePageEvents(sink: PageEventSink): () => void {
	pageSinks.add(sink);
	return () => {
		pageSinks.delete(sink);
	};
}

/** Drop every sink. For a bridge that stopped, and for a test that must not leak one into the next. */
export function clearPageEvents(): void {
	pageSinks.clear();
}

/** How many sinks are armed. Test-visible only, so a leak between cases is provable. */
export function pageSinkCount(): number {
	return pageSinks.size;
}

/**
 * The `app:` half of a lifecycle event, published from the one place that also wakes `app.on`
 * listeners — so a page and the backend can never see different events, or different order.
 * A sink that throws is named and never stops the others or the backend fan-out.
 */
export function publishPageEvent(event: AppEvent, at: number = Date.now()): void {
	for (const sink of pageSinks) {
		try {
			sink(`app:${event}`, { event, at });
		} catch (error) {
			const text = error instanceof Error ? error.message : String(error);
			console.warn(`  lifecycle a page listener for app:${event} threw: ${text}`);
		}
	}
}

/**
 * Watch for the moment every window is closed.
 *
 * `platform.windowLabels()` is the live set, not the configured one: a page that opens a second
 * window with `window.create` keeps the app alive after the configured window closes. A platform
 * without that call falls back to the config list, which is the old behaviour rather than none.
 *
 * `notified` is what makes this fire once: the check runs on a timer, so a closed window would
 * otherwise emit `window-all-closed` every tick until the process ended.
 */
export function watchWindows(
	config: CrustConfig,
	platform: Platform,
	onClosed: () => void,
	intervalMs: number = 250,
): ReturnType<typeof setInterval> | undefined {
	const labels = platform.windowLabels?.bind(platform);
	if (labels === undefined && config.windows.length === 0) return undefined;
	let notified = false;
	const handle = setInterval(() => {
		const open =
			labels !== undefined
				? labels()
				: config.windows
						.filter((window: WindowConfig) => platform.window(window.label))
						.map((window: WindowConfig) => window.label);
		if (open.length > 0 || notified) return;
		notified = true;
		onClosed();
	}, intervalMs);
	handle.unref?.();
	return handle;
}

/**
 * Drain a platform's lifecycle queue into `app.on` listeners.
 *
 * Same rule as `window-all-closed`: a listener that throws is named and never blocks termination. A
 * `before-quit` is deferred on the native side, so `settle` runs after its listeners (throwing or
 * not) — otherwise a thrown listener would leave AppKit waiting for a reply it never gets. The
 * timer is unref'd: watching for events must not by itself keep a process alive.
 */
export function watchLifecycle(
	listeners: Map<AppEvent, Set<AppListener>>,
	source: LifecycleSource,
	intervalMs: number = LIFECYCLE_CHECK_INTERVAL_MS,
): ReturnType<typeof setInterval> {
	const handle = setInterval(() => {
		let events: AppEvent[];
		try {
			events = source.take();
		} catch {
			// A platform that reports no such concept simply yields nothing; the refusal is returned by
			// `unsupportedLifecycle` when it is asked for.
			return;
		}
		for (const event of events) {
			// The page hears it from this same loop, before the backend listeners are awaited, so the
			// forward happens exactly once per drained event and the two cannot drift.
			publishPageEvent(event);
			void emit(listeners, event)
				.catch((error: unknown) => {
					const text = error instanceof Error ? error.message : String(error);
					console.warn(`  lifecycle a ${event} listener threw: ${text}`);
				})
				.finally(() => {
					if (event === "before-quit") source.settle?.();
				});
		}
	}, intervalMs);
	handle.unref?.();
	return handle;
}
