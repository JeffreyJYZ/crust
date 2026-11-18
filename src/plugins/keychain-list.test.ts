/**
 * `keychain.list` and its refusal. Split from `keychain.test.ts` at the 200-line cap: the enumeration
 * behaviour and the per-platform "needs" text are one responsibility, the other commands another.
 */

import { describe, expect, test } from "bun:test";
import { createKeychainPlugin } from "./keychain.ts";
import { fakeKeychain } from "./keychain-fake.ts";

const LIST_API = {
	darwin: "SecItemCopyMatching in Security.framework",
	win32: "CredEnumerateW in advapi32",
	linux: "secret_service_search_sync in libsecret",
} as const;

/** The refusal, pinned to a platform through the injectable argument. */
async function refuseList(platform: string) {
	const without = { ...fakeKeychain(), list: undefined };
	return createKeychainPlugin(without, platform).commands.list({ service: "app" });
}

describe("list", () => {
	test("answers every account under one service, sorted, and empty is a real answer", async () => {
		const plugin = createKeychainPlugin(
			fakeKeychain([
				["app", "token", "x"],
				["app", "refresh", "y"],
				["other", "token", "z"],
			]),
		);

		expect(await plugin.commands.list({ service: "app" })).toEqual({
			ok: true,
			accounts: ["refresh", "token"],
		});
		expect(await plugin.commands.list({ service: "empty" })).toEqual({
			ok: true,
			accounts: [],
		});
	});

	test("a platform half without list names the current platform's enumeration API", async () => {
		const needs =
			LIST_API[process.platform as keyof typeof LIST_API] ?? "a credential enumeration API";
		expect(await refuseList(process.platform)).toEqual({
			ok: false,
			code: "not-implemented",
			requires: needs,
			message: expect.stringContaining(`keychain.list needs ${needs}`),
		});
	});

	test("win32 names CredEnumerateW, the API its credential store actually needs", async () => {
		// `platform` is injected because this suite runs on macOS; pinning win32 through
		// process.platform alone would make the assertion host-dependent and untestable here.
		const needs = LIST_API.win32;
		expect(await refuseList("win32")).toEqual({
			ok: false,
			code: "not-implemented",
			requires: needs,
			message: expect.stringContaining(`keychain.list needs ${needs}`),
		});
	});

	test("linux names secret_service_search_sync, not Windows' API", async () => {
		const needs = LIST_API.linux;
		expect(await refuseList("linux")).toEqual({
			ok: false,
			code: "not-implemented",
			requires: needs,
			message: expect.stringContaining(`keychain.list needs ${needs}`),
		});
	});
});
