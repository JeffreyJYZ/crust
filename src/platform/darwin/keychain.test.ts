/**
 * The macOS keychain half, proven without the login keychain. The C unit is compiled and its symbols
 * probed — which never stores, reads or deletes anything — and every command case drives a fake shim,
 * so the suite cannot touch the human's real credentials.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	darwinKeychainAdapter,
	KEYCHAIN_STATUS,
	keychainUnitStatus,
	LIST_CHUNK,
	SECRET_CHUNK,
	splitAccounts,
	type KeychainShim,
} from "@/platform/darwin/keychain.ts";

const notDarwin = process.platform !== "darwin";

/** A shim that answers as told, so no case needs Security.framework. */
function shim(overrides: Partial<KeychainShim> = {}): KeychainShim & { log: string[] } {
	const log: string[] = [];
	return {
		log,
		available: () => true,
		set: () => KEYCHAIN_STATUS.ok,
		get: () => KEYCHAIN_STATUS.refused,
		delete: () => 0,
		list: () => 0,
		...overrides,
	};
}

/** Copy a secret into the caller's buffer the way the C half does, and report the full length. */
function fill(text: string) {
	return (_service: string, _account: string, into: Uint8Array): number => {
		const bytes = new TextEncoder().encode(text);
		const copied = Math.min(bytes.length, into.length - 1);
		into.set(bytes.subarray(0, copied));
		into[copied] = 0;
		return bytes.length;
	};
}

/** The same for the NUL-separated account list, which carries no terminator of its own. */
function fillList(names: readonly string[]) {
	return (_service: string, into: Uint8Array): number => {
		const bytes = new TextEncoder().encode(names.map((name) => `${name}\0`).join(""));
		const copied = Math.min(bytes.length, into.length);
		into.set(bytes.subarray(0, copied));
		return bytes.length;
	};
}

describe("the keychain C unit", () => {
	test.skipIf(notDarwin)("compiles through cc() and answers every symbol", () => {
		// `cc()` refuses a symbol it cannot resolve, so this is the proof Security.framework serves
		// every export. Nothing is written: the probe only asks whether the pointers bound.
		const status = keychainUnitStatus();
		expect(status.reason).toBe("compiled");
		expect(status.available).toBe(true);
	});

	test("a missing credential is null, not a throw", () => {
		const keychain = darwinKeychainAdapter(shim());

		// `KEYCHAIN_STATUS.refused` is what the C half answers for errSecItemNotFound, and the
		// plugin turns it into `{ found: false }`; throwing here would make a first launch crash.
		expect(keychain.get("app", "absent")).toBeNull();
	});

	test("a secret longer than the first buffer is re-read at its exact length", () => {
		const long = "k".repeat(SECRET_CHUNK + 500);
		const keychain = darwinKeychainAdapter(shim({ get: fill(long) }));

		expect(keychain.get("app", "token")).toBe(long);
	});

	test("a secret that keeps growing is refused, never returned truncated", () => {
		// A secret replaced by a longer one on every read must not be clamped to the buffer and
		// answered as `{ found: true }` — a truncated key is silently wrong. Refuse after retries.
		let calls = 0;
		const keychain = darwinKeychainAdapter(
			shim({
				get: (_service, _account, into) => {
					calls++;
					const text = "z".repeat(into.length + 16);
					into.set(new TextEncoder().encode(text).subarray(0, into.length - 1));
					return text.length;
				},
			}),
		);

		expect(() => keychain.get("app", "token")).toThrow("kept growing");
		expect(calls).toBe(3);
	});

	test("a list that keeps growing is refused, never returned truncated", () => {
		let calls = 0;
		const keychain = darwinKeychainAdapter(
			shim({
				list: (_service, into) => {
					calls++;
					const bytes = new TextEncoder().encode(`${"L".repeat(into.length + 16)}\0`);
					into.set(bytes.subarray(0, Math.min(bytes.length, into.length)));
					return bytes.length;
				},
			}),
		);

		expect(() => keychain.list?.("app")).toThrow("kept growing");
		expect(calls).toBe(3);
	});

	test("a bad-name status is a refusal, not a silent empty secret", () => {
		const keychain = darwinKeychainAdapter(shim({ get: () => KEYCHAIN_STATUS.badName }));

		expect(() => keychain.get("app", "token")).toThrow("refused the read");
	});

	test("set reports a refusal instead of claiming the secret was stored", () => {
		const refused = darwinKeychainAdapter(shim({ set: () => KEYCHAIN_STATUS.refused }));
		const badName = darwinKeychainAdapter(shim({ set: () => KEYCHAIN_STATUS.badName }));

		expect(() => refused.set("app", "token", "x")).toThrow("refused the write");
		expect(() => badName.set("app", "token", "x")).toThrow("name is unusable");
	});

	test("delete answers false for nothing stored, true for a removal, and throws only on a refusal", () => {
		expect(darwinKeychainAdapter(shim({ delete: () => 0 })).delete("app", "t")).toBe(false);
		expect(darwinKeychainAdapter(shim({ delete: () => 1 })).delete("app", "t")).toBe(true);
		expect(() => darwinKeychainAdapter(shim({ delete: () => -1 })).delete("app", "t")).toThrow(
			"refused the delete",
		);
	});

	test("list splits the NUL-separated buffer, drops duplicates and sorts", () => {
		expect(splitAccounts(new TextEncoder().encode("b\0a\0a\0"))).toEqual(["a", "b"]);
		expect(splitAccounts(new Uint8Array(0))).toEqual([]);

		const keychain = darwinKeychainAdapter(shim({ list: fillList(["token", "refresh"]) }));
		expect(keychain.list?.("app")).toEqual(["refresh", "token"]);
	});

	test("a list longer than the first buffer is re-read exactly", () => {
		// 6000 names is past LIST_CHUNK, so the first call reports a length the buffer cannot hold
		// and the adapter must ask again rather than truncate the list.
		const names = Array.from({ length: 6000 }, (_, index) => `account-${index}`);
		const keychain = darwinKeychainAdapter(shim({ list: fillList(names) }));

		const listed = keychain.list?.("app") ?? [];
		expect(listed.length).toBe(names.length);
		// Sorted lexicographically, so `account-999` is last and `account-0` first — the point is
		// the whole set survives, not its order.
		expect(listed).toContain("account-3999");
		expect(listed).toContain("account-5999");
		expect(LIST_CHUNK).toBeLessThan(names.length * 12);
	});

	test("list sizes each account from its own length, never a fixed stack buffer", () => {
		// A fixed `char small[256]` made CFStringGetCString fail for any longer name, and the
		// loop's `continue` then dropped it — set accepts it and get finds it, but list hid it.
		const source = readFileSync(join(import.meta.dir, "shim", "119_keychain_b.c"), "utf8");
		const list = source.slice(source.indexOf("long long shim_keychain_list"));
		expect(list).toContain("CFStringGetMaximumSizeForEncoding");
		expect(list).not.toContain("char small[256]");
		// A name that will not fit is reported back so the adapter re-reads at the exact size.
		expect(list).toContain("total += room");
	});

	test("list re-reads at the reported size when one name will not fit the first buffer", () => {
		// The C half reports the full size it needs even when it wrote only part of the list,
		// just as `get` reports the secret's full length. The adapter must ask again.
		const long = "L".repeat(LIST_CHUNK + 32);
		let calls = 0;
		const keychain = darwinKeychainAdapter(
			shim({
				list: (_service, into) => {
					calls++;
					const bytes = new TextEncoder().encode(`${long}\0`);
					into.set(bytes.subarray(0, Math.min(bytes.length, into.length)));
					return bytes.length;
				},
			}),
		);

		expect(keychain.list?.("app")).toEqual([long]);
		expect(calls).toBe(2);
	});
});
