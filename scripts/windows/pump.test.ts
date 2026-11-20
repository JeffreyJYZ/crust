/**
 * The pump assertion, tested on the machine that cannot run the smoke: the point of the 2026-11-20
 * change is that "idle" and "dead" must be told apart, and this file is where that distinction is
 * proved rather than described.
 *
 * `ticks` climbs in all three cases — a Bun timer runs whether or not Win32 is there — so the only
 * number that can answer the question is a dispatch of a message this process queued.
 */
import { expect, test } from "bun:test";
import type { WindowsPlatform } from "../../src/platform/windows/index.ts";
import { provePump } from "./pump.ts";

/**
 * A platform with a window whose pump dispatches `dispatch` messages per slice, and a post that
 * answers `posted`. `already` is traffic that was in the queue before the post.
 */
function fakePlatform(dispatch: number, posted: number, already = 0): WindowsPlatform {
	let messages = already;
	let ticks = 0;
	return {
		nativeWindow: () => 42,
		shim: () => ({ shim_window_post_null: () => posted }),
		get nativeMessages() {
			return messages;
		},
		get ticks() {
			return ticks;
		},
		pump: () => {
			messages += dispatch;
			ticks++;
		},
		stopPump: () => {},
	} as unknown as WindowsPlatform;
}

test("a live pump answers with the dispatch of the message it posted", async () => {
	const proof = await provePump(fakePlatform(1, 1), 60);
	expect(proof).toEqual({ posted: 1, dispatched: 1, ticks: 1, ok: true });
});

test("an idle queue is a refusal to prove anything, never a failure of the pump", async () => {
	// The 44754720437 shape: eight live slices, nothing queued, a perfectly healthy pump.
	const proof = await provePump(fakePlatform(0, 1), 60);
	expect(proof.ok).toBe(false);
	expect(proof.dispatched).toBe(0);
	expect(proof.ticks).toBe(1);
});

test("a window that refuses the post cannot be reported as a dead pump", async () => {
	const proof = await provePump(fakePlatform(0, 0), 60);
	expect(proof.ok).toBe(false);
	expect(proof.posted).toBe(0);
});

test("the count is a delta, so earlier traffic cannot answer for the posted message", async () => {
	// Five messages were already dispatched before this proof began; a dead pump must still fail.
	const quiet = await provePump(fakePlatform(0, 1, 5), 60);
	expect(quiet.dispatched).toBe(0);
	expect(quiet.ok).toBe(false);
	const live = await provePump(fakePlatform(1, 1, 5), 60);
	expect(live.dispatched).toBe(1);
	expect(live.ok).toBe(true);
});
