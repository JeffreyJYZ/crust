/**
 * A refused command must be visible at the transport layer while the page keeps seeing the typed
 * failure value it always saw. Both halves are proved here; the 1817-test suite is the broader
 * compatibility proof that no caller that ignores a result was given a new rejection.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { createWindowPlugin } from "@/plugins/window.ts";
import { fakeAdapter } from "@/plugins/window-fake.ts";
import { statusForCode } from "../errors.ts";
import { installPage } from "../client/fixtures.ts";
import { resultStatus } from "./failure-status.ts";
import { headers, invoke, readJson, start, stopAll } from "./fixtures.ts";

afterEach(stopAll);

function windowBridge() {
	return start({ handlers: [createWindowPlugin(fakeAdapter(["main"]))] });
}

function auth(bridge: ReturnType<typeof windowBridge>) {
	return headers(bridge, { authorization: `Bearer ${bridge.token}` });
}

describe("a plugin failure value reaches the transport status", () => {
	test("a refused window command is non-200 while a successful one stays 200", async () => {
		const bridge = windowBridge();
		const ok = await invoke(bridge, auth(bridge), {
			plugin: "window",
			command: "list",
			args: {},
		});
		expect(ok.status).toBe(200);
		expect((await readJson(ok)).result.ok).toBe(true);

		const refused = await invoke(bridge, auth(bridge), {
			plugin: "window",
			command: "close",
			args: { label: "missing" },
		});
		expect(refused.status).toBe(404);
		const body = await readJson(refused);
		// The envelope is unchanged, so the page client still resolves the result instead of throwing.
		expect(body.ok).toBe(true);
		expect(body.result).toMatchObject({
			ok: false,
			code: "unknown-window",
			label: "missing",
		});
	});

	test("the page client resolves the typed failure and a healthy ready", async () => {
		const bridge = windowBridge();
		const { api } = installPage(bridge, { stream: false });
		const answer = await (api.invoke as any)("window", "close", { label: "missing" });
		expect(answer).toMatchObject({ ok: false, code: "unknown-window" });
		// The 404 belongs to the command, not to the bridge the page just reached.
		await expect(api.ready).resolves.toBeUndefined();
	});

	test("resultStatus uses the CrustError table and leaves every success at 200", () => {
		expect(resultStatus({ ok: true })).toBe(200);
		expect(resultStatus(undefined)).toBe(200);
		expect(resultStatus({ ok: false, code: "unknown-window" })).toBe(404);
		expect(resultStatus({ ok: false, code: "invalid-size" })).toBe(400);
		expect(resultStatus({ ok: false, code: "invalid-title" })).toBe(400);
		expect(resultStatus({ ok: false, code: "unknown-adapter" })).toBe(501);
		expect(resultStatus({ ok: false, code: "handler-error" })).toBe(500);
		expect(resultStatus({ ok: false, code: "a-third-party-code" })).toBe(400);
	});

	test("every inherited Object.prototype name stays a 4xx refusal", () => {
		const inherited = [
			"__proto__",
			"constructor",
			"toString",
			"valueOf",
			"hasOwnProperty",
			"isPrototypeOf",
			"propertyIsEnumerable",
		];
		for (const code of inherited) {
			expect(resultStatus({ ok: false, code })).toBe(400);
			expect(statusForCode(code as never)).toBe(500);
		}
	});

	test("a command that ran and failed is 5xx, not a caller error", () => {
		const serverFaults = [
			"signature-mismatch",
			"hash-mismatch",
			"unverified-artifact",
			"relaunch-failed",
			"io-error",
			"corrupt",
			"sql-error",
			"contract-violation",
		];
		for (const code of serverFaults) {
			expect(resultStatus({ ok: false, code })).toBe(500);
		}
	});
});
