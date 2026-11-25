/**
 * The transition wait for the fullscreen capture probe. An accessory window joins whatever Space is
 * active when it is created, so the reported state cannot be born into: it appears when another app
 * goes fullscreen *after* the window exists. This module parses that flag and polls read-only state.
 * It never activates, orders, moves a window or changes a Space.
 */

/** Flag given without a value waits this long, short enough to keep an operator at the keyboard. */
export const DEFAULT_WAIT_SECONDS = 15;

/** Upper bound, so a mistyped number cannot hold a terminal for hours. */
export const MAX_WAIT_SECONDS = 300;

/** One read per second: steady enough to catch a keypress, quiet enough to leave the terminal readable. */
export const POLL_MS = 1000;

export const USAGE = "usage: bun run scripts/probe-capture-fullscreen.ts [--wait [seconds]]";

export interface WaitArgs {
	/** `undefined` means the unchanged no-wait default. */
	seconds?: number;
	error?: string;
}

/** Parse `--wait`, `--wait N` and `--wait=N`; reject everything else with a printable reason. */
export function parseWait(args: string[]): WaitArgs {
	if (args.length === 0) return {};
	let value: string | undefined;
	if (args.length === 1 && args[0] === "--wait") value = undefined;
	else if (args.length === 2 && args[0] === "--wait") value = args[1];
	else if (args.length === 1 && args[0]?.startsWith("--wait=")) value = args[0].slice(7);
	else return { error: `unexpected arguments: ${args.join(" ")}` };
	if (value === undefined) return { seconds: DEFAULT_WAIT_SECONDS };
	if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > MAX_WAIT_SECONDS)
		return { error: `--wait needs a whole number of seconds (1-${MAX_WAIT_SECONDS})` };
	return { seconds: Number(value) };
}

export interface Condition {
	ok: boolean;
	/** The blocker on the last read, printed when the wait expires. */
	reason: string;
}

export interface WaitResult {
	ok: boolean;
	waitedMs: number;
	last: Condition;
}

/**
 * Read once immediately, then at most once per `POLL_MS` until true or the deadline. `sleep` and
 * `now` are injected so a unit test can advance a fake clock instead of holding the screen.
 */
export async function waitForCondition(
	read: () => Promise<Condition>,
	seconds: number,
	sleep: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms),
	now: () => number = () => Date.now(),
): Promise<WaitResult> {
	const started = now();
	const deadline = started + seconds * 1000;
	let last = await read();
	while (!last.ok && now() < deadline) {
		await sleep(Math.min(POLL_MS, deadline - now()));
		last = await read();
	}
	return { ok: last.ok, waitedMs: now() - started, last };
}
