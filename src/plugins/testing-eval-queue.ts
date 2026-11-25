/**
 * Request identity for the one native evaluation channel. A WebKit completion block carries no
 * request id, so a late answer must be matched to the command that asked for it; without this, a
 * timed-out evaluation settles the *next* command with the stale answer. Kept local to `testing`
 * (rather than a shared helper) because the C sink here is the only one with this shape.
 */

import type { DroppedCompletion, TimeoutDetail } from "./testing-eval-types.ts";

export type { DroppedCompletion, TimeoutDetail } from "./testing-eval-types.ts";

export interface EvalQueueOptions {
	/** Start one evaluation. `id` is echoed by the native sink when the answer arrives. */
	send: (id: number, target: number, bytes: Uint8Array) => number;
	timeoutMs?: number;
	/**
	 * Wall clock for the real deadline. A page WebKit considers hidden runs at low QoS and can answer
	 * tens of seconds later while the runner's own pump keeps ticking; pump progress alone measured
	 * the runner, not the page. Defaults to `performance.now`.
	 */
	wall?: () => number;
	/**
	 * Optional pump progress clock. The wall deadline may only fire once this clock has advanced by
	 * the budget too: a runner starved enough to stop its pump has not had a turn to deliver the
	 * answer, so that case still pauses instead of failing.
	 */
	progress?: () => number;
	/** Optional page frame counter, sampled at the start and the expiry of every wait. */
	frames?: () => number;
	/** Optional `document.visibilityState`, sampled at the same two points as `frames`. */
	visibility?: () => string;
	/** Optional non-rAF page tick count; unlike frames it advances in a hidden page. */
	heartbeat?: () => number;
	/** Optional native count of completions delivered off the sink's thread. */
	offMain?: () => number;
	/** Diagnostic hook for an answer whose id has no waiter; the count is kept regardless. */
	onDrop?: (drop: DroppedCompletion) => void;
	/** Printed unconditionally on a real timeout: that is when evidence matters most. */
	onTimeout?: (detail: TimeoutDetail) => void;
}

/** A liveness budget, not a correctness bound: a hidden page may answer well after this. */
export const EVAL_TIMEOUT_MS = 30_000;

interface Waiter {
	settle: (value: string) => void;
	fail: (error: Error) => void;
}

export interface EvalQueue {
	run(target: number, script: string): Promise<string>;
	/** Settle the one request this completion belongs to; drop it if that request already timed out. */
	deliver(id: number, kind: number, text: string): void;
	pending(): number;
	/** Completions whose id had no waiter: stale, duplicate or mismatched answers. */
	dropped(): number;
}

/** How often the deadline is checked; the budget itself is measured by `progress`. */
const CHECK_MS = 16;

/**
 * Correlate completions by a monotonic id. The buffer is copied for the send and dropped after it:
 * the C side's `te_nsstring` copies the bytes into an NSString synchronously, so retaining one entry
 * per command for the process lifetime buys nothing and leaks the whole script source.
 */
export function createEvalQueue(options: EvalQueueOptions): EvalQueue {
	const timeoutMs = options.timeoutMs ?? EVAL_TIMEOUT_MS;
	const wall = options.wall ?? (() => performance.now());
	const progress = options.progress;
	const wallStart = wall();
	const waiters = new Map<number, Waiter>();
	let nextId = 0;
	let drops = 0;

	const forget = (id: number): Waiter | undefined => {
		const waiter = waiters.get(id);
		waiters.delete(id);
		return waiter;
	};

	return {
		deliver(id, kind, text) {
			const waiter = forget(id);
			// A completion whose request is gone is a late answer from a timeout. It must not settle
			// whichever command happens to hold the channel now. Count it and expose the ids that
			// were live: a mismatch here used to be indistinguishable from no completion at all.
			if (waiter === undefined) {
				drops++;
				options.onDrop?.({
					id,
					kind,
					text,
					waitedIds: [...waiters.keys()],
					elapsedMs: Math.round(wall() - wallStart),
				});
				return;
			}
			if (kind === 0) waiter.settle(text);
			else if (kind === 1) waiter.fail(new Error(text || "crust: the page threw"));
			else waiter.fail(new Error("crust: the page answered nothing"));
		},

		run(target, script) {
			const id = ++nextId;
			return new Promise<string>((resolve, reject) => {
				const started = wall();
				const progressStart = progress?.();
				const framesStart = options.frames?.() ?? -1;
				const visibilityStart = options.visibility?.() ?? "n/a";
				const heartbeatStart = options.heartbeat?.() ?? -1;
				let timer: ReturnType<typeof setInterval> | undefined;
				const done = (): void => {
					if (timer !== undefined) clearInterval(timer);
					timer = undefined;
				};
				// Installed before the send: a completion that arrives during the send is not lost.
				waiters.set(id, {
					settle: (value) => {
						done();
						resolve(value);
					},
					fail: (error) => {
						done();
						reject(error);
					},
				});
				const bytes = new TextEncoder().encode(script);
				const status = options.send(id, target, bytes);
				if (status !== 0) {
					forget(id);
					reject(new Error(`crust: evaluateJavaScript did not start (status ${status})`));
					return;
				}
				timer = setInterval(() => {
					const wallNow = wall();
					if (wallNow - started < timeoutMs) return;
					// The runner must have had its own turns as well: a starved pump has not delivered
					// the completion yet, so the wall clock alone must not fail the page for it.
					if (
						progress !== undefined &&
						(progressStart ?? 0) + timeoutMs > (progress?.() ?? 0)
					)
						return;
					done();
					// Capture before forget: the expiring id belongs in the evidence, and deleting it
					// first is what made an earlier diagnostic print `waited=[]` while waiting on it.
					const waitedIds = [...waiters.keys()];
					if (forget(id) === undefined) return;
					options.onTimeout?.({
						id,
						waitedIds,
						progressStart: progressStart ?? -1,
						progressNow: progress?.() ?? -1,
						wallStart: started,
						wallNow,
						elapsedMs: Math.round(wallNow - started),
						framesStart,
						framesNow: options.frames?.() ?? -1,
						visibilityStart,
						visibilityNow: options.visibility?.() ?? "n/a",
						heartbeatStart,
						heartbeatNow: options.heartbeat?.() ?? -1,
						offMain: options.offMain?.() ?? -1,
					});
					reject(new Error(`crust: the page did not answer within ${timeoutMs} ms`));
				}, CHECK_MS);
				// An unanswered promise must not keep a quitting process alive.
				if (typeof timer === "object" && timer !== null && "unref" in timer) timer.unref();
			});
		},

		pending() {
			return waiters.size;
		},

		dropped() {
			return drops;
		},
	};
}

export { createLabeledQueue } from "./testing-label-queue.ts";
