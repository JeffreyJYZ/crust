/**
 * The transition wait for the fullscreen capture probe. The measured condition is the composited bit
 * on the probe's own window, which can clear when another app goes fullscreen after the window exists.
 * This module parses that flag and polls read-only state. It never activates, orders, moves a window
 * or changes a Space. `--composited` is a harness-only way to force the bit for the refusal test.
 */

/** Flag given without a value waits this long, short enough to keep an operator at the keyboard. */
export const DEFAULT_WAIT_SECONDS = 15;

/** Upper bound, so a mistyped number cannot hold a terminal for hours. */
export const MAX_WAIT_SECONDS = 300;

/** One read per second: steady enough to catch a keypress, quiet enough to leave the terminal readable. */
export const POLL_MS = 1000;

export const USAGE =
	"usage: bun run scripts/probe-capture-fullscreen.ts [--wait [seconds]] [--composited]";

export interface WaitArgs {
	/** `undefined` means the unchanged no-wait default. */
	seconds?: number;
	/** Harness-only: force AppKit's composited bit so the refusal path has a real window to read. */
	forceComposite?: boolean;
	error?: string;
}

/** Parse `--wait`, `--wait N`, `--wait=N` and `--composited`; reject everything else with a reason. */
export function parseWait(args: string[]): WaitArgs {
	const forceComposite = args.includes("--composited");
	const rest = args.filter((arg) => arg !== "--composited");
	const forced = forceComposite ? { forceComposite: true } : {};
	if (rest.length === 0) return forced;
	let value: string | undefined;
	if (rest.length === 1 && rest[0] === "--wait") value = undefined;
	else if (rest.length === 2 && rest[0] === "--wait") value = rest[1];
	else if (rest.length === 1 && rest[0]?.startsWith("--wait=")) value = rest[0].slice(7);
	else return { error: `unexpected arguments: ${args.join(" ")}` };
	if (value === undefined) return { ...forced, seconds: DEFAULT_WAIT_SECONDS };
	if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > MAX_WAIT_SECONDS)
		return { error: `--wait needs a whole number of seconds (1-${MAX_WAIT_SECONDS})` };
	return { ...forced, seconds: Number(value) };
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
