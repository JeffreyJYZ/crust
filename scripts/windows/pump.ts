/**
 * The pump proof, as its own module because the smoke is at the line cap: post one message and watch
 * `shim_pump` dispatch it.
 *
 * This replaces a count of traffic nobody queued. The old assertion read `nativeMessages >= 1` after a
 * 120 ms sleep and hoped WebView2 had left a message behind; a fresh window with an empty queue and a
 * dead pump answer identically — `PeekMessageW` returning FALSE *is* an idle pump — and a loaded
 * runner queued nothing in that window (2026-11-20, run 44754720437: 0 messages over 8 live slices,
 * 120 ms, every `ticks` accounted for). Posting the message ourselves makes the assertion true of a
 * live pump and false of a dead one, whatever the load.
 */
import type { WindowsPlatform } from "../../src/platform/windows/index.ts";

/** How long a message may sit in the queue before the pump is called dead. Generous on purpose: the
 * bound is a deadline on a loaded runner, never a sleep hoping for traffic. */
export const PUMP_BOUND_MS = 4000;

export interface PumpProof {
	/** What `shim_window_post_null` answered: 1 queued, 0 refused, so no proof was possible. */
	posted: number;
	/** `shim_pump` dispatches since the post. A dead pump leaves this at 0. */
	dispatched: number;
	/** Timer slices the wait cost, so a failure says whether the timer ran at all. */
	ticks: number;
	ok: boolean;
}

/**
 * Queue one `WM_NULL` on the window and pump until a slice dispatches something, bounded. A message
 * posted by us cannot be dispatched by a stubbed pump, and the count is taken from before the post so
 * a message that arrived earlier cannot answer for ours.
 */
export async function provePump(
	platform: WindowsPlatform,
	boundMs: number = PUMP_BOUND_MS,
): Promise<PumpProof> {
	const hwnd = platform.nativeWindow("smoke") ?? 0;
	const shim = platform.shim();
	const before = platform.nativeMessages;
	const posted = hwnd > 0 && shim ? Number(shim.shim_window_post_null(hwnd)) : 0;
	platform.pump(16);
	const deadline = Date.now() + boundMs;
	// The pump is a Bun timer, so waiting is what lets its slices run; the deadline is what stops a
	// dead pump from turning this into a hang.
	while (posted === 1 && platform.nativeMessages === before && Date.now() < deadline) {
		await Bun.sleep(20);
	}
	const dispatched = platform.nativeMessages - before;
	const ticks = platform.ticks;
	platform.stopPump();
	return { posted, dispatched, ticks, ok: posted === 1 && dispatched >= 1 };
}
