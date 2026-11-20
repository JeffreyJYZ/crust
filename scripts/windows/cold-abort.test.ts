/**
 * What may and may not be retried, as code rather than a comment. The smoke's one retry exists because
 * `E_ABORT` with a healthy environment is the runtime, and every other controller failure is a finding
 * — a test is the only way that bound is checked rather than trusted.
 */
import { expect, test } from "bun:test";
import type { WindowOptions } from "../../src/app.ts";
import type { WindowsPlatform } from "../../src/platform/windows/index.ts";
import { createWithAbortRetry, isColdControllerAbort } from "./cold-abort.ts";

const ABORT =
	'WebView2 controller failed for "smoke" (GetLastError 87, CreateCoreWebView2Controller 0x80004004, ' +
	"controller callback 0x80004004, environment callback 0x0, object ok, ctrl_from 1) — an object";

const HELD_FOLDER =
	'WebView2 controller failed for "smoke" (GetLastError 87, CreateCoreWebView2Controller 0x80004004, ' +
	"controller callback 0x80004004, environment callback 0x80070020, object ok, ctrl_from 1) — an object";

const OPTIONS: WindowOptions = { label: "smoke", title: "smoke", url: "about:blank" };

/** A platform that answers with the failures it was given, in order, and counts the calls. */
function fakePlatform(failures: string[]): { platform: WindowsPlatform; calls: () => number } {
	let calls = 0;
	const platform = {
		createWindow: () => {
			const failure = failures[calls];
			calls++;
			if (failure !== undefined) throw new Error(failure);
			return { label: "smoke" };
		},
	} as unknown as WindowsPlatform;
	return { platform, calls: () => calls };
}

test("only E_ABORT with a healthy environment is the cold-runtime abort", () => {
	expect(isColdControllerAbort(ABORT)).toBe(true);
	// A held user-data folder fails the environment callback, so a retry would only repeat it.
	expect(isColdControllerAbort(HELD_FOLDER)).toBe(false);
	// Anything that is not the controller failing at all is never retried.
	expect(isColdControllerAbort('CreateWindowExW failed for "smoke" (GetLastError 87)')).toBe(
		false,
	);
});

test("a cold abort is retried exactly once", () => {
	const { platform, calls } = fakePlatform([ABORT]);
	expect(createWithAbortRetry(platform, OPTIONS)).toBeUndefined();
	expect(calls()).toBe(2);
});

test("a second cold abort is the finding, not a third attempt", () => {
	const { platform, calls } = fakePlatform([ABORT, ABORT]);
	expect(createWithAbortRetry(platform, OPTIONS)).toBe(ABORT);
	expect(calls()).toBe(2);
});

test("any other refusal is reported without a retry", () => {
	const refusal = 'WebView2 controller failed for "smoke" (controller callback 0x80070005)';
	const { platform, calls } = fakePlatform([refusal]);
	expect(createWithAbortRetry(platform, OPTIONS)).toBe(refusal);
	expect(calls()).toBe(1);
});
