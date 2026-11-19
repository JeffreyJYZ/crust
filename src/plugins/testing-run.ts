/**
 * The one place a `testing` command reaches the page. Every command, in both halves, calls `run`,
 * so the adapter check, the JSON envelope and the page's own refusal are parsed once.
 */

import type { NotImplemented } from "./define";
import { answered, labelOf, missing, refused } from "./testing-args";
import { pageScript, type TestingScriptName } from "./testing-script";
import type { TestingAdapter, TestingArgs, TestingFailure } from "./testing-types";

/** Run one command's script in the named window's page and answer its typed result. */
export type Runner = <T>(
	command: TestingScriptName,
	args: Record<string, unknown>,
) => Promise<T | TestingFailure | NotImplemented>;

/** Build a runner over whatever adapter the plugin was given, resolved per call. */
export function createRunner(native: () => TestingAdapter | undefined): Runner {
	return async <T>(
		command: TestingScriptName,
		args: Record<string, unknown>,
	): Promise<T | TestingFailure | NotImplemented> => {
		const evaluator = native();
		if (!evaluator) return missing(command);
		let raw: unknown;
		try {
			raw = await evaluator.evaluate(labelOf(args as TestingArgs), pageScript(command, args));
		} catch (error) {
			return refused(error);
		}
		return answered(command, raw) as T | TestingFailure;
	};
}
