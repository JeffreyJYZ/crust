/**
 * Two findings at the Windows adapter boundary, where a fake `advapi32` shim is enough to prove both
 * without a Windows machine: a backslash lets two `(service, account)` pairs collapse onto one
 * `service\account` target, and a secret that grows between the size probe and the re-read was once
 * decoded from a clamped prefix.
 */

import { describe, expect, test } from "bun:test";
import {
	SECRET_CHUNK,
	WINDOWS_KEYCHAIN_STATUS,
	windowsKeychainAdapter,
	type WindowsKeychainShim,
} from "./keychain.ts";

function shim(overrides: Partial<WindowsKeychainShim> = {}): WindowsKeychainShim {
	return {
		available: () => true,
		set: () => WINDOWS_KEYCHAIN_STATUS.ok,
		get: () => WINDOWS_KEYCHAIN_STATUS.refused,
		delete: () => 0,
		list: () => null,
		...overrides,
	};
}

/** Copy a secret into the caller buffer the way the C half does. */
function fill(text: string) {
	return (_service: string, _account: string, into: Uint8Array): number => {
		const bytes = new TextEncoder().encode(text);
		const copied = Math.min(bytes.length, into.length - 1);
		into.set(bytes.subarray(0, copied));
		into[copied] = 0;
		return bytes.length;
	};
}

describe("names that would collide on one target", () => {
	test("a backslash is refused before any call reaches advapi32", () => {
		const calls: string[] = [];
		const keychain = windowsKeychainAdapter(
			shim({
				set: () => {
					calls.push("set");
					return WINDOWS_KEYCHAIN_STATUS.ok;
				},
				get: () => {
					calls.push("get");
					return WINDOWS_KEYCHAIN_STATUS.refused;
				},
				delete: () => {
					calls.push("delete");
					return 0;
				},
				list: () => {
					calls.push("list");
					return null;
				},
			}),
		);
		const pairs: [string, string][] = [
			["a", "b\\c"],
			["a\\b", "c"],
		];
		for (const [service, account] of pairs) {
			expect(() => keychain.set(service, account, "s")).toThrow("backslash");
			expect(() => keychain.get(service, account)).toThrow("backslash");
			expect(() => keychain.delete(service, account)).toThrow("backslash");
		}
		expect(() => keychain.list?.("a\\b")).toThrow("backslash");
		expect(calls).toEqual([]);
	});
});

describe("a secret that keeps growing between reads", () => {
	test("is refused rather than decoded from a clamped prefix", () => {
		const keychain = windowsKeychainAdapter(
			shim({
				get: (_service, _account, into) => {
					into[0] = 0;
					return into.length + 100;
				},
			}),
		);
		expect(() => keychain.get("app", "token")).toThrow("truncated secret");
	});

	test("settles after a grow and answers the whole secret", () => {
		const long = "g".repeat(SECRET_CHUNK + 400);
		let probe = true;
		const keychain = windowsKeychainAdapter(
			shim({
				get: (_service, _account, into) => {
					if (probe) {
						probe = false;
						return into.length + 400;
					}
					return fill(long)("app", "token", into);
				},
			}),
		);
		expect(keychain.get("app", "token")).toBe(long);
	});
});
