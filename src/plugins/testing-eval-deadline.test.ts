/**
 * The eval deadline distinguishes a slow-but-alive page from a hung one. Both clocks are fake here:
 * `wall` is the real budget and `progress` is the pump gate. The 22 s answer in this file is the
 * one measured on the released head (run 45563816639), where the pump advanced its full 4 s budget
 * while the hidden WebContent process took twenty seconds more to call the completion block.
 */
import { describe, expect, test } from "bun:test";

import { createEvalQueue, EVAL_TIMEOUT_MS, type TimeoutDetail } from "./testing-eval-queue.ts";

function fakeClocks(initial = 0) {
	let wall = initial;
	let progress = initial;
	return {
		wall: () => wall,
		progress: () => progress,
		advance(ms: number) {
			wall += ms;
			progress += ms;
		},
	};
}

describe("the eval liveness budget", () => {
	test("the budget is longer than the measured late answer", () => {
		expect(EVAL_TIMEOUT_MS).toBeGreaterThan(22_000);
	});

	test("an answer 22 s late resolves: the page was slow, not lost", async () => {
		const clock = fakeClocks();
		const queue = createEvalQueue({
			send: () => 0,
			timeoutMs: EVAL_TIMEOUT_MS,
			wall: clock.wall,
			progress: clock.progress,
		});
		const answer = queue.run(1, "x");
		clock.advance(22_000);
		await Bun.sleep(40);
		// A 4000 ms budget would already have rejected here. The live page has not.
		expect(queue.pending()).toBe(1);
		queue.deliver(1, 0, "LATE-BUT-CORRECT");
		await expect(answer).resolves.toBe("LATE-BUT-CORRECT");
		expect(queue.pending()).toBe(0);
	});

	test("a page that never answers still fails, naming the id it was waiting on", async () => {
		const clock = fakeClocks();
		const timeouts: TimeoutDetail[] = [];
		const queue = createEvalQueue({
			send: () => 0,
			timeoutMs: EVAL_TIMEOUT_MS,
			wall: clock.wall,
			progress: clock.progress,
			visibility: () => "hidden",
			heartbeat: () => 137,
			onTimeout: (detail) => timeouts.push(detail),
		});
		const answer = queue.run(1, "x");
		// Twice the old budget, with neither a completion nor a stopping pump: this is a hang.
		clock.advance(EVAL_TIMEOUT_MS);
		await expect(answer).rejects.toThrow(/did not answer/);
		expect(queue.pending()).toBe(0);
		expect(timeouts).toHaveLength(1);
		expect(timeouts[0]).toMatchObject({
			id: 1,
			waitedIds: [1],
			elapsedMs: EVAL_TIMEOUT_MS,
			visibilityStart: "hidden",
			visibilityNow: "hidden",
			heartbeatStart: 137,
			heartbeatNow: 137,
		});
	});

	test("a late completion after a real timeout reports how late it was", async () => {
		const clock = fakeClocks();
		let elapsed = -1;
		const queue = createEvalQueue({
			send: () => 0,
			timeoutMs: 100,
			wall: clock.wall,
			progress: clock.progress,
			onDrop: (drop) => {
				elapsed = drop.elapsedMs;
			},
		});
		const answer = queue.run(1, "x");
		clock.advance(100);
		await expect(answer).rejects.toThrow(/did not answer/);
		clock.advance(22_000);
		queue.deliver(1, 0, "late payload");
		expect(elapsed).toBe(22_100);
		expect(queue.dropped()).toBe(1);
	});
});
