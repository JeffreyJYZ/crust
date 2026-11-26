/**
 * The wait is a transition, so its logic is tested with a fake clock: no real screen, no real sleep,
 * no activation. The flag must leave the default path alone and the poll must stop at the first true
 * read or at the deadline with the last blocker intact.
 */
import { expect, test } from "bun:test";
import {
	DEFAULT_WAIT_SECONDS,
	MAX_WAIT_SECONDS,
	parseWait,
	POLL_MS,
	waitForCondition,
} from "./wait.ts";

function clock() {
	let now = 0;
	return {
		now: () => now,
		sleep: async (ms: number) => {
			now += ms;
		},
	};
}

test("no flag keeps the unchanged no-wait default", () => {
	expect(parseWait([])).toEqual({});
});

test("--wait alone takes the short default", () => {
	expect(parseWait(["--wait"])).toEqual({ seconds: DEFAULT_WAIT_SECONDS });
});

test("--wait N and --wait=N both parse", () => {
	expect(parseWait(["--wait", "7"])).toEqual({ seconds: 7 });
	expect(parseWait(["--wait=7"])).toEqual({ seconds: 7 });
});

test("--composited is harness-only and leaves the wait default alone", () => {
	expect(parseWait(["--composited"])).toEqual({ forceComposite: true });
	expect(parseWait(["--wait", "7", "--composited"])).toEqual({
		seconds: 7,
		forceComposite: true,
	});
});

test("bad --wait refuses with a reason instead of hanging", () => {
	for (const args of [
		["--wait", "0"],
		["--wait", "-2"],
		["--wait", "abc"],
		["--wait", "x"],
		["--wait=1", "extra"],
		["--later"],
	]) {
		expect(parseWait(args).error).toBeString();
		expect(parseWait(args).seconds).toBeUndefined();
	}
	expect(parseWait(["--wait", String(MAX_WAIT_SECONDS + 1)]).error).toBeString();
});

test("poll stops at the first true read and reports the seconds waited", async () => {
	const c = clock();
	let reads = 0;
	const result = await waitForCondition(
		async () => {
			reads++;
			return reads >= 3 ? { ok: true, reason: "met" } : { ok: false, reason: "desktop" };
		},
		15,
		c.sleep,
		c.now,
	);
	expect(result.ok).toBe(true);
	expect(result.waitedMs).toBe(POLL_MS * 2);
	expect(reads).toBe(3);
});

test("a true initial read does not sleep or move anything", async () => {
	const c = clock();
	let reads = 0;
	const result = await waitForCondition(
		async () => {
			reads++;
			return { ok: true, reason: "already fullscreen" };
		},
		15,
		c.sleep,
		c.now,
	);
	expect(result.waitedMs).toBe(0);
	expect(reads).toBe(1);
});

test("timeout carries the last blocker out", async () => {
	const c = clock();
	const result = await waitForCondition(
		async () => ({ ok: false, reason: "frontmost Ghostty has no fullscreen window" }),
		3,
		c.sleep,
		c.now,
	);
	expect(result.ok).toBe(false);
	expect(result.waitedMs).toBe(3000);
	expect(result.last.reason).toBe("frontmost Ghostty has no fullscreen window");
});
