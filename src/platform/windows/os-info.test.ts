/**
 * `os.info` and `os.locale` on Windows, driven through the fake shim. The version is the interesting
 * one: `RtlGetVersion` is the only call that reports the real build, and a component it could not
 * read must be a failure rather than the `-1.-1.-1` a naive join would print.
 *
 * The rest of `info` — `platform`, `arch`, `family`, `exeExtension`, `hostname` — is read from Bun in
 * `src/plugins/os.ts`, so it is not this adapter's claim.
 */
import { describe, expect, test } from "bun:test";
import { createOsPlugin } from "@/plugins/os";
import { NO_WINDOWS_SHIM } from "./active-shim.ts";
import type { FakeOptions } from "./fake-backend.ts";
import { fakeShim } from "./fake-shim.ts";
import { windowsOsAdapter } from "./os-info.ts";

/** An adapter over a fake shim, with every answer stated by the test. */
function adapter(options: FakeOptions = {}) {
	return windowsOsAdapter(() => fakeShim(options));
}

describe("os.info's native half on Windows", () => {
	test("the version is the three components RtlGetVersion reported", () => {
		expect(adapter({ osVersion: [10, 0, 22631] }).systemVersion()).toBe("10.0.22631");
	});

	test("a component that could not be read is a failure, not -1.-1.-1", () => {
		expect(() => adapter({ osVersion: [-1, 0, 0] }).systemVersion()).toThrow("RtlGetVersion");
	});

	test("the locale is the BCP-47 tag Windows writes", () => {
		expect(adapter({ osLocale: "en-GB" }).locale()).toBe("en-GB");
	});

	test("an empty locale is a failure, not the empty string", () => {
		expect(() => adapter({ osLocale: "" }).locale()).toThrow("GetUserDefaultLocaleName");
	});

	test("uptime is GetTickCount64 in seconds", () => {
		expect(adapter({ osUptime: 4321.5 }).uptime()).toBe(4321.5);
	});

	test("a zero uptime is refused rather than reported as a fresh boot", () => {
		expect(() => adapter({ osUptime: 0 }).uptime()).toThrow("GetTickCount64");
	});

	test("there is no bundle, so no app version is invented", () => {
		expect(adapter().appVersion()).toBeNull();
	});
});

describe("through the plugin, which is what a page sees", () => {
	test("info answers the version the shim reported", async () => {
		const answer = await createOsPlugin(
			adapter({ osVersion: [10, 0, 22631], osUptime: 12 }),
		).commands.info();
		expect(answer).toMatchObject({
			ok: true,
			version: "10.0.22631",
			uptime: 12,
			appVersion: null,
			exeExtension: process.platform === "win32" ? ".exe" : "",
		});
	});

	test("an unreadable version is a handler-error naming the call", async () => {
		const answer = await createOsPlugin(adapter({ osVersion: [-1, 0, 0] })).commands.info();
		expect(answer).toMatchObject({ ok: false, code: "handler-error" });
	});

	test("no platform names Win32, never NSProcessInfo", async () => {
		const plugin = createOsPlugin(windowsOsAdapter(() => undefined));
		const answer = await plugin.commands.info();
		const message = "message" in answer ? answer.message : "";
		expect(message).toContain(NO_WINDOWS_SHIM);
		expect(message).not.toContain("NSProcessInfo");
	});
});
