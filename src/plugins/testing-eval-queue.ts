/**
 * Request identity for the one native evaluation channel. A WebKit completion block carries no
 * request id, so a late answer must be matched to the command that asked for it; without this, a
 * timed-out evaluation settles the *next* command with the stale answer. Kept local to `testing`
 * (rather than a shared helper) because the C sink here is the only one with this shape.
 */

export interface EvalQueueOptions {
	/** Start one evaluation. `id` is echoed by the native sink when the answer arrives. */
	send: (id: number, target: number, bytes: Uint8Array) => number;
	timeoutMs?: number;
	/**
	 * Optional monotonic progress clock. When present, the deadline counts its advance instead of
	 * wall time: a runner starved enough to delay the completion also stops the clock that drives
	 * it, so the answer is not declared lost before the loop had a chance to deliver it.
	 */
	progress?: () => number;
}

interface Waiter {
	settle: (value: string) => void;
	fail: (error: Error) => void;
}

export interface EvalQueue {
	run(target: number, script: string): Promise<string>;
	/** Settle the one request this completion belongs to; drop it if that request already timed out. */
	deliver(id: number, kind: number, text: string): void;
	pending(): number;
}

/** How often the deadline is checked; the budget itself is measured by `progress`. */
const CHECK_MS = 16;

/**
 * Correlate completions by a monotonic id. The buffer is copied for the send and dropped after it:
 * the C side's `te_nsstring` copies the bytes into an NSString synchronously, so retaining one entry
 * per command for the process lifetime buys nothing and leaks the whole script source.
 */
export function createEvalQueue(options: EvalQueueOptions): EvalQueue {
	const timeoutMs = options.timeoutMs ?? 4000;
	const progress = options.progress;
	const waiters = new Map<number, Waiter>();
	let nextId = 0;

	const forget = (id: number): Waiter | undefined => {
		const waiter = waiters.get(id);
		waiters.delete(id);
		return waiter;
	};

	return {
		deliver(id, kind, text) {
			const waiter = forget(id);
			// A completion whose request is gone is a late answer from a timeout. It must not settle
			// whichever command happens to hold the channel now.
			if (waiter === undefined) return;
			if (kind === 0) waiter.settle(text);
			else if (kind === 1) waiter.fail(new Error(text || "crust: the page threw"));
			else waiter.fail(new Error("crust: the page answered nothing"));
		},

		run(target, script) {
			const id = ++nextId;
			return new Promise<string>((resolve, reject) => {
				const started = progress?.() ?? performance.now();
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
					if ((progress?.() ?? performance.now()) - started < timeoutMs) return;
					done();
					if (forget(id) === undefined) return;
					reject(new Error(`crust: the page did not answer within ${timeoutMs} ms`));
				}, CHECK_MS);
				// An unanswered promise must not keep a quitting process alive.
				if (typeof timer === "object" && timer !== null && "unref" in timer) timer.unref();
			});
		},

		pending() {
			return waiters.size;
		},
	};
}

/** Only commands against the same window serialise; a hung evaluation on A cannot hold up B. */
export function createLabeledQueue(): {
	run<T>(label: string | undefined, task: () => Promise<T>): Promise<T>;
	clear(): void;
} {
	const chains = new Map<string, Promise<unknown>>();
	return {
		run(label, task) {
			const key = label ?? "";
			const previous = chains.get(key) ?? Promise.resolve();
			const next = previous.then(task, task);
			chains.set(
				key,
				next.catch(() => undefined),
			);
			return next;
		},
		clear() {
			chains.clear();
		},
	};
}
