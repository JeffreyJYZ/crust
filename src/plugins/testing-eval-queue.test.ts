/**
 * The request-identity state machine, proved without a WKWebView. The old code kept one `pending`
 * slot and one global promise chain, so a completion arriving after its own command timed out
 * settled the next command with the stale answer, and a hung command on one window held up another.
 */
import { describe, expect, test } from "bun:test";

import { createEvalQueue, createLabeledQueue } from "./testing-eval-queue.ts";

/** A promise that exposes its settle/reject so a test can drive the queue deterministically. */
function deferred() {
	let settle!: (value: string) => void;
	let fail!: (error: Error) => void;
	const promise = new Promise<string>((resolve, reject) => {
		settle = resolve;
		fail = reject;
	});
	return { promise, settle, fail };
}

describe("native evaluation correlation", () => {
	test("a late completion for a timed-out request does not settle the next command", async () => {
		const ids: number[] = [];
		const queue = createEvalQueue({
			send: (id) => {
				ids.push(id);
				return 0;
			},
			timeoutMs: 15,
		});
		const first = queue.run(1, "first");
		await expect(first).rejects.toThrow(/did not answer/);
		const second = queue.run(1, "second");
		expect(second).toBeInstanceOf(Promise);
		// The stale answer carries the first id. The correlator must drop it, leaving `second` pending.
		queue.deliver(ids[0] ?? 0, 0, "STALE-FROM-FIRST");
		expect(queue.pending()).toBe(1);
		// The real answer for the second id settles only the second command.
		queue.deliver(ids[1] ?? 0, 0, "FRESH-FOR-SECOND");
		await expect(second).resolves.toBe("FRESH-FOR-SECOND");
		expect(queue.pending()).toBe(0);
	});

	test("two in-flight commands keep their own answers apart", async () => {
		const ids: number[] = [];
		const queue = createEvalQueue({
			send: (id) => {
				ids.push(id);
				return 0;
			},
			timeoutMs: 1000,
		});
		const a = queue.run(1, "a");
		const b = queue.run(2, "b");
		queue.deliver(ids[1] ?? 0, 0, "answer-b");
		queue.deliver(ids[0] ?? 0, 0, "answer-a");
		await expect(a).resolves.toBe("answer-a");
		await expect(b).resolves.toBe("answer-b");
	});

	test("a send that never starts leaves no pending entry", async () => {
		const queue = createEvalQueue({ send: () => 7 });
		await expect(queue.run(1, "x")).rejects.toThrow(/status 7/);
		expect(queue.pending()).toBe(0);
	});

	test("an error completion reports the page's message and clears the waiter", async () => {
		const queue = createEvalQueue({ send: () => 0, timeoutMs: 1000 });
		const answer = queue.run(1, "x");
		queue.deliver(1, 1, "page threw");
		await expect(answer).rejects.toThrow(/page threw/);
		expect(queue.pending()).toBe(0);
	});
});

describe("per-window queue", () => {
	test("a hung command on one window does not hold up another", async () => {
		const labeled = createLabeledQueue();
		const a = deferred();
		const b = deferred();
		const started: string[] = [];
		const first = labeled.run("window-a", () => {
			started.push("a");
			return a.promise;
		});
		const second = labeled.run("window-b", () => {
			started.push("b");
			return b.promise;
		});
		await Bun.sleep(0);
		// B started even though A has not settled: no cross-window head-of-line blocking.
		expect(started).toEqual(["a", "b"]);
		a.settle("a done");
		b.settle("b done");
		await expect(first).resolves.toBe("a done");
		await expect(second).resolves.toBe("b done");
	});

	test("commands against the same window still serialise", async () => {
		const labeled = createLabeledQueue();
		const started: string[] = [];
		const first = labeled.run("window-a", async () => {
			started.push("first");
			await Bun.sleep(10);
			return 1;
		});
		const second = labeled.run("window-a", async () => {
			started.push("second");
			return 2;
		});
		await expect(first).resolves.toBe(1);
		await expect(second).resolves.toBe(2);
		expect(started).toEqual(["first", "second"]);
	});

	test("a rejected command does not poison the next one on that window", async () => {
		const labeled = createLabeledQueue();
		await expect(
			labeled.run("window-a", async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		await expect(labeled.run("window-a", async () => 2)).resolves.toBe(2);
	});
});
