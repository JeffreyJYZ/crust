/**
 * The harness a check runs on: one PASS or FAIL line per step, a throw turned
 * into a FAIL rather than a silent gap, and a deadline so a native sheet that is
 * waiting for a human is a result instead of a hang.
 */
import { describe } from "../bridge";

/** Resolves only once the line has reached its destination, so callers can await order. */
export type Reporter = (line: string) => Promise<void>;

export interface Checks {
	report: Reporter;
	pass: (name: string, detail: string) => Promise<void>;
	fail: (name: string, why: string) => Promise<void>;
	check: <T>(
		name: string,
		run: () => Promise<T>,
		ok: (value: T) => string | false,
	) => Promise<boolean>;
}

export function makeChecks(report: Reporter): Checks {
	const pass = async (name: string, detail: string): Promise<void> =>
		await report(`PASS ${name} — ${detail}`);
	const fail = async (name: string, why: string): Promise<void> =>
		await report(`FAIL ${name} — ${why}`);

	/** Run one check; a throw is a FAIL line, never a silent gap. */
	const check = async <T,>(
		name: string,
		run: () => Promise<T>,
		ok: (value: T) => string | false,
	): Promise<boolean> => {
		try {
			const detail = ok(await run());
			if (detail === false) await fail(name, "unexpected answer");
			else await pass(name, detail);
			return detail !== false;
		} catch (error) {
			await fail(name, describe(error));
			return false;
		}
	};

	return { report, pass, fail, check };
}

/** Answers at `ms`, or reports that the call is still pending. */
export function settle<T>(
	run: Promise<T>,
	ms: number,
): Promise<{ done: true; value: T } | { done: false }> {
	const timeout = new Promise<{ done: false }>((resolve) => {
		setTimeout(() => resolve({ done: false }), ms);
	});
	return Promise.race([run.then((value) => ({ done: true as const, value })), timeout]);
}
