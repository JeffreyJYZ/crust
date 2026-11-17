/**
 * `crust:keychain` — the OS credential store. Every case here is a behaviour a report would name:
 * a missing credential is `{ found: false }` and not an error, a name that could address the wrong
 * entry is refused, and a platform with no adapter refuses by name instead of writing a plaintext file.
 */

import { describe, expect, test } from "bun:test";
import { createKeychainPlugin, KEYCHAIN_COMMANDS } from "./keychain.ts";
import { fakeKeychain } from "./keychain-fake.ts";

const notDarwinOrWin = process.platform !== "darwin" && process.platform !== "win32";

describe("set, get and delete", () => {
	test("a stored secret comes back, and the two names reached the native half", async () => {
		const native = fakeKeychain();
		const plugin = createKeychainPlugin(native);

		expect(
			await plugin.commands.set({ service: "app", account: "token", secret: "s3cret" }),
		).toEqual({
			ok: true,
			stored: true,
		});
		expect(await plugin.commands.get({ service: "app", account: "token" })).toEqual({
			ok: true,
			found: true,
			secret: "s3cret",
		});
		expect(native.calls()).toEqual(["set app/token", "get app/token"]);
	});

	/**
	 * The finding this case answers: "not stored" is a normal answer. A refusal a caller must catch
	 * makes a first launch look broken, and an `{ ok: false }` makes it look like a denial.
	 */
	test("a missing credential is found:false, never an error", async () => {
		const plugin = createKeychainPlugin(fakeKeychain());

		expect(await plugin.commands.get({ service: "app", account: "absent" })).toEqual({
			ok: true,
			found: false,
		});
	});

	test("delete reports whether an entry existed, and both outcomes are ok", async () => {
		const plugin = createKeychainPlugin(fakeKeychain([["app", "token", "x"]]));

		expect(await plugin.commands.delete({ service: "app", account: "token" })).toEqual({
			ok: true,
			deleted: true,
		});
		expect(await plugin.commands.delete({ service: "app", account: "token" })).toEqual({
			ok: true,
			deleted: false,
		});
	});

	test("an empty secret is a real secret, so only a non-string is refused", async () => {
		const native = fakeKeychain();
		const plugin = createKeychainPlugin(native);

		expect(await plugin.commands.set({ service: "app", account: "blank", secret: "" })).toEqual(
			{
				ok: true,
				stored: true,
			},
		);
		expect(await plugin.commands.get({ service: "app", account: "blank" })).toEqual({
			ok: true,
			found: true,
			secret: "",
		});
		expect(
			await plugin.commands.set({ service: "app", account: "bad", secret: 7 as never }),
		).toEqual({
			ok: false,
			code: "bad-request",
			message: 'keychain.set: "secret" must be a string',
		});
	});
});

describe("names a caller may not pass", () => {
	/**
	 * A NUL truncates the name inside the C string every platform half hands the OS, so two different
	 * credentials would collapse onto one entry — a secret read back for the wrong account.
	 */
	test("a NUL in a name is refused, so two names cannot collapse onto one entry", async () => {
		const native = fakeKeychain();
		const plugin = createKeychainPlugin(native);

		expect(
			await plugin.commands.set({ service: "app\0evil", account: "a", secret: "s" }),
		).toEqual({
			ok: false,
			code: "bad-request",
			message: 'keychain.set: "service" must be a non-empty string',
		});
		expect(native.calls()).toEqual([]);
	});

	test("an empty name is refused by the command that took it, and nothing reaches the native half", async () => {
		const native = fakeKeychain();
		const plugin = createKeychainPlugin(native);

		expect(await plugin.commands.get({ service: "", account: "a" })).toEqual({
			ok: false,
			code: "bad-request",
			message: 'keychain.get: "service" must be a non-empty string',
		});
		expect(await plugin.commands.get({ service: "app", account: "" })).toEqual({
			ok: false,
			code: "bad-request",
			message: 'keychain.get: "account" must be a non-empty string',
		});
		expect(native.calls()).toEqual([]);
	});
});

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

	test("a platform half without list answers not-implemented naming CredEnumerateW", async () => {
		const native = fakeKeychain();
		// Windows binds no `CredEnumerateW`, so its adapter omits `list` rather than returning [].
		const without = { ...native, list: undefined };
		const plugin = createKeychainPlugin(without);

		const answer = await plugin.commands.list({ service: "app" });
		expect(answer).toMatchObject({
			ok: false,
			code: "not-implemented",
			requires: "CredEnumerateW",
		});
	});
});

describe("a native refusal and a missing platform", () => {
	test("a throwing adapter becomes handler-error carrying its message, not a rejected invoke", async () => {
		const native = fakeKeychain();
		native.fail("the keychain is locked");
		const plugin = createKeychainPlugin(native);

		expect(await plugin.commands.get({ service: "app", account: "token" })).toEqual({
			ok: false,
			code: "handler-error",
			message: "the keychain is locked",
		});
	});

	test("no adapter refuses every command by name, and Linux names libsecret", async () => {
		const plugin = createKeychainPlugin();
		for (const command of KEYCHAIN_COMMANDS) {
			const answer = await plugin.commands[command]({
				service: "app",
				account: "a",
			} as never);
			expect(answer).toMatchObject({ ok: false, code: "not-implemented" });
			const requires = (answer as { requires?: string }).requires ?? "";
			// The refusal names what the platform would need, so nobody reads it as "crust is broken".
			expect(requires.length).toBeGreaterThan(0);
			if (notDarwinOrWin) expect(requires).toContain("libsecret");
		}
	});
});
