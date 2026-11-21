/**
 * Honesty proofs for `crust:testing`: `waitFor` must report the time it actually spent and wrap a
 * page failure in a typed answer, `click`/`clickAt` must not claim a click nobody observed, and the
 * DOM test double must mark its answers so a suite cannot read them as proof about a real page.
 */

import { describe, expect, test } from "bun:test";

import { createTestingPlugin } from "./testing";
import type { Runner } from "./testing-run";
import { testPage } from "./testing-fixture";
import { observeCommands } from "./testing-observe";

const asResult = <T>(value: unknown): T => value as T;

describe("testing.waitFor honesty", () => {
	test("waitedMs is the wall time spent, not the configured budget", async () => {
		// Each probe really costs 30 ms. The old loop counted one WAIT_INTERVAL_MS per iteration and
		// reported 50 ms for ~110 ms of waiting; the polls themselves were free in its arithmetic.
		let probes = 0;
		const runner: Runner = async <T>(
			_command: Parameters<Runner>[0],
			args: Parameters<Runner>[1],
		) => {
			await Bun.sleep(30);
			const selector = (args as { selector: string }).selector;
			if (++probes < 2) {
				return asResult<T>({
					ok: false,
					code: "not-found",
					message: `no element matches ${selector}`,
				});
			}
			return asResult<T>({ ok: true, exists: true });
		};
		const before = performance.now();
		const answer = await observeCommands(runner).waitFor({ selector: "#late", timeoutMs: 500 });
		const elapsed = performance.now() - before;
		expect(answer).toMatchObject({ ok: true, found: true });
		const waited = "waitedMs" in answer ? answer.waitedMs : -1;
		expect(typeof waited).toBe("number");
		expect(waited).toBeGreaterThanOrEqual(elapsed - 12);
	});

	test("a page failure is a structured failure naming the wait, not the raw page answer", async () => {
		const runner: Runner = async <T>() =>
			asResult<T>({ ok: false, code: "handler-error", message: "the page threw" });
		const answer = await observeCommands(runner).waitFor({ selector: "#go", timeoutMs: 100 });
		expect(answer).toMatchObject({ ok: false, code: "handler-error" });
		expect("message" in answer && answer.message).toContain("testing.waitFor");
		expect("message" in answer && answer.message).toContain("#go");
	});
});

describe("testing click proof", () => {
	test("click claims a click only when a listener on the element observed the event", async () => {
		const fake = testPage();
		const seen: string[] = [];
		fake.button.addEventListener("click", () => seen.push("click"));
		const answer = await createTestingPlugin(fake.adapter).commands.click({ selector: "#go" });
		expect(seen).toEqual(["click"]);
		expect(answer).toMatchObject({ ok: true, clicked: true, verified: true });
	});

	test("clickAt claims a click only when the painted element observed the event", async () => {
		const fake = testPage();
		const seen: string[] = [];
		fake.button.addEventListener("click", () => seen.push("click"));
		const answer = await createTestingPlugin(fake.adapter).commands.clickAt({ x: 20, y: 20 });
		expect(seen).toEqual(["click"]);
		expect(answer).toMatchObject({ ok: true, clicked: true, verified: true });
	});

	test("a click that dispatches no event answers clicked:false, verified:false", async () => {
		const fake = testPage();
		// A page whose click() is a no-op: nothing observed, so nothing may be claimed.
		fake.button.click = () => {};
		const answer = await createTestingPlugin(fake.adapter).commands.click({ selector: "#go" });
		expect(answer).toMatchObject({ ok: true, clicked: false, verified: false });
	});
});

describe("the fake's answers are marked", () => {
	test("successes and refusals both carry fake:true", async () => {
		const fake = testPage();
		const commands = createTestingPlugin(fake.adapter).commands;
		const answers = [
			await commands.click({ selector: "#go" }),
			await commands.query({ selector: "#go" }),
			await commands.click({ selector: "#nope" }),
		];
		for (const answer of answers) {
			expect((answer as unknown as Record<string, unknown>).fake).toBe(true);
		}
	});
});
