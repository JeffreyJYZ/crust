/**
 * The keychain's boundary when its native half is absent, and the promise that no secret reaches a
 * file. The 0600 file fallback an older bundle relied on is gone: a secret that is not in the OS store
 * never answers `ok`, and a refusal names the OS call that failed.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
	darwinKeychainAdapter,
	KEYCHAIN_STATUS,
	type KeychainShim,
} from "@/platform/darwin/keychain.ts";
import {
	windowsKeychainAdapter,
	WINDOWS_KEYCHAIN_STATUS,
	type WindowsKeychainShim,
} from "@/platform/windows/keychain.ts";

import { createKeychainPlugin, KEYCHAIN_COMMANDS } from "./keychain.ts";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

/** The OS call each platform's refusal must name when there is no adapter at all. */
const REQUIRED_CALLS: Record<string, readonly string[]> = {
	darwin: ["SecItemAdd", "SecItemCopyMatching", "SecItemDelete"],
	win32: ["CredWriteW", "CredReadW", "CredDeleteW"],
	linux: ["libsecret"],
};

describe("an absent native adapter", () => {
	test("every command answers a typed refusal naming the platform call", async () => {
		for (const [platform, calls] of Object.entries(REQUIRED_CALLS)) {
			const plugin = createKeychainPlugin(undefined, platform);
			for (const command of KEYCHAIN_COMMANDS) {
				const answer = await plugin.commands[command]({
					service: "app",
					account: "token",
					secret: "never-stored",
				} as never);
				expect(answer).toMatchObject({ ok: false, code: "not-implemented" });
				const requires = (answer as { requires?: string }).requires ?? "";
				expect(requires.length).toBeGreaterThan(0);
				for (const call of calls) expect(requires).toContain(call);
			}
		}
	});

	test("an unrecognised platform refuses by name, never a silent success", async () => {
		const plugin = createKeychainPlugin(undefined, "plan9");
		const answer = await plugin.commands.set({ service: "app", account: "a", secret: "x" });
		expect(answer).toMatchObject({ ok: false, code: "not-implemented" });
		expect((answer as { requires?: string }).requires).toContain("OS credential store");
	});

	test("absence outranks argument validation: no secret is acknowledged", async () => {
		const plugin = createKeychainPlugin(undefined, "darwin");
		const answer = await plugin.commands.set({ service: "", account: "", secret: "x" });
		expect(answer).toMatchObject({ ok: false, code: "not-implemented" });
	});
});

describe("a native refusal", () => {
	test("the adapter's OS error reaches the caller verbatim as handler-error", async () => {
		const osError = "SecItemAdd: errSecMissingEntitlement (-34018)";
		const plugin = createKeychainPlugin({
			platform: "darwin",
			set: () => {
				throw new Error(osError);
			},
			get: () => null,
			delete: () => false,
		});
		const answer = await plugin.commands.set({ service: "app", account: "a", secret: "s" });
		expect(answer).toEqual({ ok: false, code: "handler-error", message: osError });
	});

	test("the macOS half names SecItemAdd and its status on a refused write", async () => {
		// This is the ad-hoc bundle path: no application-identifier entitlement, so the OS refuses
		// the write and the plugin must answer handler-error — never a file, never ok.
		const shim: KeychainShim = {
			available: () => true,
			set: () => KEYCHAIN_STATUS.refused,
			get: () => KEYCHAIN_STATUS.refused,
			delete: () => 0,
			list: () => 0,
		};
		const plugin = createKeychainPlugin(darwinKeychainAdapter(shim), "darwin");
		const answer = await plugin.commands.set({ service: "app", account: "a", secret: "s" });
		expect(answer).toMatchObject({ ok: false, code: "handler-error" });
		const message = (answer as { message?: string }).message ?? "";
		expect(message).toContain("SecItemAdd");
		expect(message).toContain(String(KEYCHAIN_STATUS.refused));
	});

	test("the Windows half names CredWriteW and its status on a refused write", async () => {
		const shim: WindowsKeychainShim = {
			available: () => true,
			set: () => WINDOWS_KEYCHAIN_STATUS.refused,
			get: () => WINDOWS_KEYCHAIN_STATUS.refused,
			delete: () => 0,
			list: () => null,
		};
		const plugin = createKeychainPlugin(windowsKeychainAdapter(shim), "win32");
		const answer = await plugin.commands.set({ service: "app", account: "a", secret: "s" });
		expect(answer).toMatchObject({ ok: false, code: "handler-error" });
		expect((answer as { message?: string }).message).toContain("CredWriteW");
	});
});

describe("no secret reaches a file", () => {
	test("the plugin and every adapter are free of file writes", () => {
		const files = [
			"src/plugins/keychain.ts",
			"src/plugins/keychain-types.ts",
			"src/plugins/keychain-fake.ts",
			"src/platform/darwin/keychain.ts",
			"src/platform/windows/keychain.ts",
			"src/platform/linux/keychain.ts",
		];
		for (const file of files) {
			expect(read(file)).not.toMatch(/writeFile|appendFile|createWriteStream|Bun\.write/);
		}
	});

	test("there is no file-backed keychain opt-in to take silently", () => {
		const plugin = read("src/plugins/keychain.ts");
		expect(plugin).not.toContain("CRUST_KEYCHAIN_FILE");
		expect(plugin).not.toContain("keychain.file");
		// The shims write content-hashed C source to tmpdir for TinyCC, never a credential.
		expect(read("src/platform/darwin/keychain-ffi.ts")).toContain(
			"writeFileSync(file, UNIT_SOURCE)",
		);
		expect(read("src/platform/windows/keychain-ffi.ts")).toContain(
			"writeFileSync(file, keychainSource)",
		);
	});
});
