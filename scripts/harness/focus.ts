/**
 * Hand focus back to whatever app the human was using before a probe launched or activated a GUI app. Every crust launch activates its app — AppKit only lists windows on the active Space, so the app has to be active to be in the accessibility tree — which means a harness that stops at its verdict leaves the person staring at a test window. That window is whoever was frontmost before the probe, not a fixed terminal.
 * Capture before the probe launches (`captureFrontmost()`), then pass the saved name to `restoreFocus(saved)` afterwards. A name that could not be captured falls back to the terminal the gates are run from; `restoreFocus()` with no argument keeps that fallback for old callers. Everything here is a courtesy, never an assertion: each spawn is timeboxed and every failure is swallowed, so a wedged System Events or a missing app cannot hang or fail a run.
 * `guardFocus()` (see `guard.ts`, re-exported here) is the same courtesy for the case a suite cannot write itself: a Ctrl-C, a `kill` or a CI timeout runs no `finally`, so it captures once and restores from `exit` and the three signals.
 * `restoreFocusVerified()` is for a caller that wants to know the restore landed: `open -a` returns before activation settles, so it reads the frontmost app back a bounded number of times and reports the name it actually saw instead of claiming a restore it never got.
 */
import { COMMAND_TIMEOUT_MS, type CommandResult, FALLBACK_APP, FRONTMOST_SCRIPT } from "./guard.ts";

/** How many times a verified restore reads the frontmost app back before giving up. */
export const VERIFY_ATTEMPTS = 6;

/** The gap between those reads: six over ~1.25 s is longer than activation takes. */
export const VERIFY_DELAY_MS = 250;

/** A restore that was checked, not just attempted. */
export interface RestoreResult {
	/** True only when reading the frontmost app back matched the app that was captured. */
	restored: boolean;
	/** The last name read back, so a miss says which app is in front rather than nothing. */
	actual?: string;
}

/** Injection points, so a unit test of the polling never waits and never touches the screen. */
export interface VerifyOptions {
	attempts?: number;
	delayMs?: number;
	/** Injected sleep; defaults to `Bun.sleep`. */
	sleep?: (ms: number) => Promise<void>;
}

export type { CommandResult } from "./guard.ts";
export {
	type GuardEvent,
	type GuardHooks,
	type GuardOptions,
	type GuardSignal,
	GUARD_SIGNALS,
	guardFocus,
	makeGuard,
	type SyncRunner,
} from "./guard.ts";

/**
 * Injectable command runner. Defaults to a timeboxed `Bun.spawn`; tests pass their own so they
 * never touch the real frontmost app. The runner must resolve (never hang) within its timeout.
 */
export type Runner = (command: string[], timeoutMs: number) => Promise<CommandResult>;

/** The real runner: spawn, read stdout to the end, and SIGKILL on the deadline. */
const bunRunner: Runner = async (command, timeoutMs) => {
	const child = Bun.spawn(command, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
	const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
	try {
		const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
		return { code, stdout };
	} finally {
		clearTimeout(timer);
	}
};

/**
 * Build the focus operations around an injectable runner and platform. `platform` is a parameter so
 * the non-darwin early return can be tested; production passes `process.platform`.
 */
export function makeFocus(runner: Runner, platform: string) {
	/** The frontmost app's name, or undefined on non-darwin, a failed/blank osascript, or a throw. */
	const captureFrontmost = async (): Promise<string | undefined> => {
		if (platform !== "darwin") return undefined;
		try {
			const { code, stdout } = await runner(
				["osascript", "-e", FRONTMOST_SCRIPT],
				COMMAND_TIMEOUT_MS,
			);
			const name = stdout.trim();
			return code === 0 && name.length > 0 ? name : undefined;
		} catch {
			// No osascript, no window server, or a wedged System Events: no saved target.
			return undefined;
		}
	};

	/** Activate the saved app, or Ghostty if none was saved. A courtesy: never throws. */
	const restoreFocus = async (target?: string): Promise<void> => {
		if (platform !== "darwin") return;
		try {
			await runner(["open", "-a", target ?? FALLBACK_APP], COMMAND_TIMEOUT_MS);
		} catch {
			// No `open`, no window server: the courtesy is unavailable.
		}
	};

	/**
	 * Activate the saved app and read it back until it is actually frontmost. A failed read is not a
	 * failed restore — `open -a` answers before the app comes forward — so this polls a bounded
	 * number of times, then reports the name it saw last. Off macOS there is nothing to verify.
	 */
	const restoreFocusVerified = async (
		target?: string,
		options: VerifyOptions = {},
	): Promise<RestoreResult> => {
		const want = (target ?? FALLBACK_APP).trim().toLowerCase();
		await restoreFocus(target);
		if (platform !== "darwin") return { restored: true };
		const attempts = options.attempts ?? VERIFY_ATTEMPTS;
		const delayMs = options.delayMs ?? VERIFY_DELAY_MS;
		const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms));
		let actual: string | undefined;
		for (let attempt = 1; attempt <= attempts; attempt++) {
			actual = await captureFrontmost();
			if (actual?.trim().toLowerCase() === want) return { restored: true, actual };
			if (attempt < attempts) await sleep(delayMs);
		}
		return { restored: false, actual };
	};

	return { captureFrontmost, restoreFocus, restoreFocusVerified };
}

export const { captureFrontmost, restoreFocus, restoreFocusVerified } = makeFocus(
	bunRunner,
	process.platform,
);
