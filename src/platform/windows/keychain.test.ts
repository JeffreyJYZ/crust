/**
 * The Windows keychain half, proven without advapi32. Nothing on this machine can call `CredReadW`,
 * so every case drives a fake shim of the same shape; the C unit is read from disk for the two
 * properties a type system cannot see — that it resolves its entry points at runtime and that it is
 * not welded into the window shim.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	SECRET_CHUNK,
	WINDOWS_KEYCHAIN_STATUS,
	windowsKeychainAdapter,
	type WindowsKeychainShim,
} from "./keychain.ts";

const DIR = import.meta.dir;
const SHIM = join(DIR, "shim", "48_keychain.c");
const source = readFileSync(SHIM, "utf8");

/** A shim that answers as told, so no case needs advapi32. */
function shim(overrides: Partial<WindowsKeychainShim> = {}): WindowsKeychainShim {
	return {
		available: () => true,
		set: () => WINDOWS_KEYCHAIN_STATUS.ok,
		get: () => WINDOWS_KEYCHAIN_STATUS.refused,
		delete: () => 0,
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

describe("a secret that does not fit the first buffer", () => {
	test("is re-read at its exact length rather than truncated", () => {
		const long = "w".repeat(SECRET_CHUNK + 300);
		const keychain = windowsKeychainAdapter(shim({ get: fill(long) }));

		expect(keychain.get("app", "token")).toBe(long);
	});
});

describe("what a status means", () => {
	test("nothing stored is null, and the plugin turns that into found:false", () => {
		const keychain = windowsKeychainAdapter(shim());

		expect(keychain.get("app", "absent")).toBeNull();
	});

	test("a refusal throws so the plugin can answer handler-error", () => {
		const keychain = windowsKeychainAdapter(shim({ get: () => -1 }));
		// `refused` is the not-stored sentinel, so a *different* negative is the failure path.
		expect(() => windowsKeychainAdapter(shim({ get: () => -7 })).get("a", "b")).toThrow(
			"refused the read",
		);
		expect(keychain.get("a", "b")).toBeNull();
	});

	test("set and delete report the store's own verdict", () => {
		expect(() =>
			windowsKeychainAdapter(shim({ set: () => WINDOWS_KEYCHAIN_STATUS.refused })).set(
				"a",
				"b",
				"c",
			),
		).toThrow("refused the write");
		expect(windowsKeychainAdapter(shim({ delete: () => 1 })).delete("a", "b")).toBe(true);
		expect(windowsKeychainAdapter(shim({ delete: () => 0 })).delete("a", "b")).toBe(false);
		expect(() => windowsKeychainAdapter(shim({ delete: () => -1 })).delete("a", "b")).toThrow(
			"refused the delete",
		);
	});

	test("there is no list, so the plugin refuses by name instead of inventing an empty array", () => {
		expect(windowsKeychainAdapter(shim()).list).toBeUndefined();
	});
});

describe("the C unit's own shape", () => {
	test("resolves every advapi32 entry point at runtime, never through an import", () => {
		// TinyCC's PE import thunk jumped to -1 on Windows x64 (2026-11-16), so the only imports are
		// the two resolvers and every credential call is a pointer bound from GetProcAddress.
		const imports = [...source.matchAll(/^extern [^;]*?([A-Za-z_]\w*)\(/gm)].map(
			(match) => match[1] ?? "",
		);
		expect(imports.sort()).toEqual(["GetProcAddress", "LoadLibraryA"]);
		for (const name of ["CredWriteW", "CredReadW", "CredDeleteW"]) {
			// The call spans lines in this unit, so the name is matched next to its resolver and
			// the file is checked for the assignment rather than the exact one-line spelling.
			expect(source).toContain(name);
			expect(source).toMatch(new RegExp(`${name} = [^;]*GetProcAddress\\(\\s*advapi`));
		}
	});

	test("is not part of the window shim, whose pointer count and module list it would move", () => {
		const parts = readFileSync(join(DIR, "shim-source.ts"), "utf8");
		expect(parts).not.toContain("48_keychain.c");
		expect(parts).toContain("47_screen.c");
	});
});
