/**
 * The observe half of `crust:testing`: `query` reads the page as it is, `waitFor` polls until an
 * element exists, and `console` returns what the bridge's page-world tap recorded from document
 * start. None of the three changes anything, so they are safe to call on every step of a test.
 */

import { CrustError } from "../bridge/errors";
import { notImplemented } from "./define";
import { pause, requireSelector } from "./testing-args";
import type { Runner } from "./testing-run";
import type {
	ConsoleResult,
	QueryResult,
	TestingConsoleArgs,
	TestingSelectorArgs,
	TestingWaitArgs,
} from "./testing-types";

/** How often `waitFor` asks the page again. */
export const WAIT_INTERVAL_MS = 50;

/** How long `waitFor` waits when the caller names no `timeoutMs`. */
export const WAIT_DEFAULT_MS = 5000;

export function observeCommands(run: Runner) {
	return {
		/** The page as it is now: presence, visibility, geometry, text, value, attributes. */
		query: async (args: TestingSelectorArgs) =>
			run<QueryResult>("query", {
				selector: requireSelector(args),
				label: args?.label,
			}),
		/** Poll until the element exists; a timeout is `not-found`, never a silent success. */
		waitFor: async (args: TestingWaitArgs) => {
			const selector = requireSelector(args);
			const asked = args?.timeoutMs;
			if (
				asked !== undefined &&
				(typeof asked !== "number" || !Number.isFinite(asked) || asked < 0)
			) {
				throw new CrustError("bad-request", 'testing.waitFor "timeoutMs" must be a number >= 0');
			}
			const timeout = asked ?? WAIT_DEFAULT_MS;
			let waited = 0;
			for (;;) {
				const probe = await run<QueryResult>("query", { selector, label: args?.label });
				if ("exists" in probe) {
					if (probe.exists) return { ok: true as const, found: true as const, waitedMs: waited };
				} else if (probe.code !== "not-found") {
					// A window that is gone or a page that threw will not fix itself by waiting.
					return probe;
				}
				if (waited >= timeout) {
					return {
						ok: false as const,
						code: "not-found" as const,
						message: `testing.waitFor: ${selector} did not appear within ${timeout} ms`,
					};
				}
				await pause(WAIT_INTERVAL_MS);
				waited += WAIT_INTERVAL_MS;
			}
		},
		/** The page's console entries, recorded by the bridge's page-world tap from document start. */
		console: async (args: TestingConsoleArgs) => {
			const since = args?.since;
			if (since !== undefined && (typeof since !== "number" || !Number.isFinite(since))) {
				throw new CrustError("bad-request", 'testing.console "since" must be a number');
			}
			const answer = await run<ConsoleResult>("console", {
				since: since ?? 0,
				label: args?.label,
			});
			if ("hooked" in answer && answer.hooked === false) {
				return notImplemented(
					"testing.console needs the page-world console tap installed at document start; " +
						"it travels in the content-world bridge's page script, so a page without that bridge has no entries to read.",
					"PAGE_CONSOLE_SOURCE at document start",
				);
			}
			return answer;
		},
	};
}
