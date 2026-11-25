/**
 * The event stream: one subscriber set, one frame format, one teardown.
 *
 * Frames are pushed in call order and never coalesced — 20 of 20 arrived in
 * order at a 20.38 ms median gap in the measurement (research/bridge.md).
 */

import { readFileSync, watch } from "node:fs";
import { basename, dirname } from "node:path";

interface Subscriber {
	enqueue(frame: string): void;
	/** The stream's remaining queue capacity. A full one drops new frames rather than growing forever. */
	readonly desiredSize?: number;
}

/**
 * Frames buffered for one stalled page before new ones are dropped. A normal burst (dozens of
 * frames, 20 in the ordering test) fits; an absent reader stops growing the queue here instead.
 */
export const EVENT_HIGH_WATER_MARK = 256;

/** The one event plain-HTML dev pushes. The page client listens for this literal name. */
export const DEV_RELOAD_EVENT = "dev:reload";
/** Set by `crust dev` before it spawns the runtime, so the bridge watches the signal. */
export const RELOAD_ENV = "CRUST_DEV_RELOAD_FILE";
/** Where `crust dev` writes the signal, inside the scratch dir the backend watcher ignores. */
export const RELOAD_FILE = ".crust/dev-reload";
/** Debounce for the signal file, so a multi-file write is one reload. */
const RELOAD_DEBOUNCE_MS = 80;

function tokenOf(file: string): string {
	try {
		return readFileSync(file, "utf8").trim();
	} catch {
		return "";
	}
}

/**
 * One SSE frame. `data` is JSON, so it can never carry a line break; `event` is a name the
 * emitter chose, and a raw `\n` in it would end the frame and let the rest forge `data:`/`event:`
 * lines for every other subscriber — so a name is forced onto one line here rather than trusted.
 */
export function sseFrame(event: string, data: unknown): string {
	let payload: string;
	try {
		payload = data === undefined ? "null" : JSON.stringify(data);
	} catch {
		payload = JSON.stringify(String(data));
	}
	const name = String(event).replace(/[\r\n]/g, " ");
	return `event: ${name}\ndata: ${payload}\n\n`;
}

export class Events {
	private readonly subscribers = new Set<Subscriber>();
	private readonly cleanups = new Set<() => void>();
	/** The stream teardown for each subscriber, so a failed `enqueue` can tear it down exactly as `cancel()` does. */
	private readonly cleanupsBySubscriber = new WeakMap<Subscriber, () => void>();
	private reloadToken: string;

	constructor(reloadFile: string | undefined = process.env[RELOAD_ENV]) {
		this.reloadToken = reloadFile === undefined ? "" : tokenOf(reloadFile);
		if (reloadFile !== undefined) this.watchReload(reloadFile);
	}

	/**
	 * Turn a dev signal file into one SSE event per change. Only `crust dev` sets the path, and
	 * only in plain-HTML mode, so a dev-server page (Vite owns reload) and a built app never see it.
	 * An empty or unreadable token is ignored: a failed rebuild must not reload the window.
	 */
	private watchReload(file: string): void {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const name = basename(file);
		let watcher: ReturnType<typeof watch>;
		try {
			watcher = watch(dirname(file), (_event, filename) => {
				if (filename !== null && String(filename) !== name) return;
				clearTimeout(timer);
				timer = setTimeout(() => {
					const next = tokenOf(file);
					if (next.length === 0 || next === this.reloadToken) return;
					this.reloadToken = next;
					this.emit(DEV_RELOAD_EVENT, { at: Date.now() });
				}, RELOAD_DEBOUNCE_MS);
			});
		} catch {
			// A missing or unwritable scratch directory is a dev-harness fault, not a reason to
			// kill the bridge: this run simply gets no reload events.
			return;
		}
		this.cleanups.add(() => {
			clearTimeout(timer);
			watcher.close();
		});
	}

	emit(event: string, data: unknown): void {
		const frame = sseFrame(event, data);
		for (const subscriber of this.subscribers) {
			// A consumer that is not reading has already filled its queue. Dropping here bounds the
			// memory a flood can use; frames that are kept still go out in the original call order.
			if (subscriber.desiredSize !== undefined && subscriber.desiredSize <= 0) continue;
			try {
				subscriber.enqueue(frame);
			} catch {
				// The controller is closed or errored without the consumer's `cancel()` having run.
				// Removing only from `subscribers` kept the cleanup, controller and subscriber alive
				// for the process lifetime. Run the stream's own teardown instead.
				this.cleanupsBySubscriber.get(subscriber)?.();
				this.subscribers.delete(subscriber);
			}
		}
	}

	/** The SSE response for one connected page, ready frame included. */
	stream(port: number, cors?: Record<string, string>): Response {
		let detached: () => void = () => {};
		const stream = new ReadableStream<Uint8Array>(
			{
				start: (controller) => {
					const encoder = new TextEncoder();
					const subscriber: Subscriber = {
						enqueue(frame: string) {
							controller.enqueue(encoder.encode(frame));
						},
						get desiredSize() {
							return controller.desiredSize ?? 0;
						},
					};
					this.subscribers.add(subscriber);
					subscriber.enqueue(sseFrame("crust:ready", { port, protocol: 1 }));
					detached = () => {
						// The closure is in `cleanups` too, so it must leave the set as well: a page
						// reload or an EventSource reconnect makes one per stream, and without the
						// delete every disconnect retains its controller and subscriber for the
						// process lifetime (and `stop()` re-runs each stale one).
						this.cleanups.delete(detached);
						this.subscribers.delete(subscriber);
						try {
							controller.close();
						} catch {
							// already closed
						}
					};
					this.cleanups.add(detached);
					this.cleanupsBySubscriber.set(subscriber, detached);
				},
				cancel: () => {
					detached();
				},
			},
			{ highWaterMark: EVENT_HIGH_WATER_MARK },
		);
		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream",
				"cache-control": "no-store",
				connection: "keep-alive",
				...(cors ?? {}),
			},
		});
	}

	/** Close every open stream; a stopped bridge holds nothing back. */
	stop(): void {
		for (const cleanup of this.cleanups) cleanup();
		this.cleanups.clear();
		this.subscribers.clear();
	}

	/**
	 * How many teardown closures are retained. Test-visible only: every disconnect must remove its
	 * own, or a page that reloads leaks one per stream for the process lifetime.
	 */
	get retainedCleanups(): number {
		return this.cleanups.size;
	}
}
