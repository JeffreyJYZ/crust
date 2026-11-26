/**
 * Wire contract for the two-process offscreen harness. B writes one readiness file; A writes one quit
 * file. A stub B in the refusal test writes the same shape, so "unreachable" is one code path.
 */
import { existsSync, readFileSync } from "node:fs";

export const READY = "CRUST_OFFSCREEN_READY";
export const QUIT = "CRUST_OFFSCREEN_QUIT";
export const TAKER = "CRUST_OFFSCREEN_TAKER";
export const TOKEN = "CRUST_OFFSCREEN_TOKEN";

export const READY_TIMEOUT_MS = 30_000;
export const QUIT_TIMEOUT_MS = 10_000;
export const TAKER_TIMEOUT_MS = 15_000;
export const POLL_MS = 50;

export interface WindowState {
	onActiveSpace: boolean;
	occlusionState: number;
}

export type Ready =
	| { status: "fullscreen"; window: WindowState; styleMask: number; ms: number }
	| { status: "unreachable"; reason: string };

/** A half-written or malformed file is no answer, never a guessed fullscreen. */
export function readReady(path: string): Ready | undefined {
	try {
		if (!existsSync(path)) return undefined;
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (typeof parsed !== "object" || parsed === null) return undefined;
		const value = parsed as Partial<Ready>;
		if (value.status === "fullscreen" || value.status === "unreachable") return value as Ready;
		return undefined;
	} catch {
		return undefined;
	}
}

/** Poll a file or state until it answers or the deadline; never a fixed sleep that guesses a Space. */
export async function waitFor<T>(
	read: () => T | undefined,
	timeoutMs: number,
	sleep: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms),
	now: () => number = () => Date.now(),
): Promise<T | undefined> {
	const deadline = now() + timeoutMs;
	for (;;) {
		const found = read();
		if (found !== undefined) return found;
		if (now() >= deadline) return undefined;
		await sleep(Math.min(POLL_MS, deadline - now()));
	}
}
