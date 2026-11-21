/**
 * The ConPTY drain's emit budget: a flood must not hold the JS pump in an unbounded `for(;;)`, and
 * the frames that do leave the ring must still arrive in the terminal's own order. The tick is
 * driven by hand so no platform timer can add a second batch between assertions.
 */

import { describe, expect, test } from "bun:test";

import { at } from "./fake-bytes.ts";
import { windowsPtyBackend } from "./pty-conpty.ts";
import type { WindowsPtyShim } from "./pty-ffi.ts";

/** A shim whose ring is the caller's queue of one-byte frames. */
function floodShim(frames: Uint8Array[]): WindowsPtyShim {
	return {
		shim_pty_load: () => 1,
		shim_pty_ready: () => 1,
		shim_pty_missing: () => "",
		shim_pty_reason: () => "",
		shim_pty_last_error: () => 0,
		shim_pty_open: () => 0,
		shim_pty_pid: () => 4242,
		shim_pty_read: (_index, dst, cap) => {
			const next = frames[0];
			if (next === undefined) return 0;
			const take = Math.min(cap, next.length);
			at(dst, take).set(next.subarray(0, take));
			if (take === next.length) frames.shift();
			else frames[0] = next.subarray(take);
			return take;
		},
		shim_pty_write: () => 0,
		shim_pty_resize: () => 1,
		shim_pty_state: () => 0,
		shim_pty_total: () => 0,
		shim_pty_exit_code: () => 0,
		shim_pty_kill: () => 1,
		shim_pty_close: () => 1,
	};
}

describe("the ConPTY emit budget", () => {
	test("a flood drains one bounded batch per tick, in the ring's order", () => {
		const frames: Uint8Array[] = [];
		for (let i = 0; i < 40; i++) frames.push(Uint8Array.from([i]));
		const seen: number[] = [];
		const original = globalThis.setInterval;
		let tick: (() => void) | undefined;
		(globalThis as unknown as { setInterval: typeof setInterval }).setInterval = ((
			fn: () => void,
		) => {
			tick = fn;
			return { unref() {} } as unknown as ReturnType<typeof setInterval>;
		}) as typeof setInterval;
		try {
			const terminal = windowsPtyBackend(() => floodShim(frames)).open({
				shell: "cmd.exe",
				args: "",
				cwd: "C:\\",
				env: {},
				cols: 80,
				rows: 24,
				onData: (bytes) => seen.push(bytes[0] ?? -1),
			});
			expect(seen).toEqual([]);
			tick?.();
			expect(seen.length).toBeGreaterThan(0);
			expect(seen.length).toBeLessThanOrEqual(8);
			for (let i = 0; i < 10; i++) tick?.();
			expect(seen).toEqual(Array.from({ length: 40 }, (_, i) => i));
			terminal.close();
		} finally {
			(globalThis as unknown as { setInterval: typeof setInterval }).setInterval = original;
		}
	});
});
