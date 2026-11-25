/** A dead SSE subscriber must release its teardown, not linger for the bridge's whole life. */

import { describe, expect, test } from "bun:test";
import { Events } from "./server/events.ts";
import { SseReader } from "./server/fixtures.ts";
describe("events cleanup", () => {
	test("a subscriber whose enqueue throws releases its stream cleanup", async () => {
		const events = new Events();
		const response = events.stream(1);
		const reader = new SseReader(response.body as ReadableStream<Uint8Array>);
		await reader.next(); // the ready frame
		expect(events.retainedCleanups).toBe(1);
		const subscriber = [
			...(events as unknown as { subscribers: Set<{ enqueue(frame: string): void }> })
				.subscribers,
		][0];
		if (subscriber === undefined) throw new Error("no subscriber registered");
		subscriber.enqueue = () => {
			throw new Error("the controller was closed without cancel()");
		};
		events.emit("boom", { n: 1 });
		expect(events.retainedCleanups).toBe(0);
	});
});
