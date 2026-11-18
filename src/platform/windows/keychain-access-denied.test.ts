/**
 * Windows keychain refusal, proven by compiling the REAL C unit against stubbed kernel32 resolvers.
 * The adapter throws on a negative status other than -1, so the shim must not collapse
 * ERROR_ACCESS_DENIED into "not stored" (docs/reviews/next-wave/native-surface.md §3).
 */

import { cc, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const source = readFileSync(join(import.meta.dir, "shim", "48_keychain.c"), "utf8");

/** kernel32 resolvers that answer nothing — the mapping helper needs no real DLL. */
const HARNESS = `
#include <stddef.h>
void *LoadLibraryA(const char *name) { (void)name; return (void *)1; }
void *GetProcAddress(void *module, const char *name) { (void)module; (void)name; return 0; }
`;

const MAIN = `
long long test_read(unsigned long error) {
	return shim_keychain_status((kc_dword)error, -1, SHIM_KC_REFUSED);
}
long long test_delete(unsigned long error) {
	return shim_keychain_status((kc_dword)error, 0, -1);
}
`;

const combined = HARNESS + "\n" + source + "\n" + MAIN;
const path = join(
	tmpdir(),
	`crust-keychain-status-${createHash("sha256").update(combined).digest("hex").slice(0, 16)}.c`,
);
if (!existsSync(path)) writeFileSync(path, combined);
const lib = cc({
	source: path,
	symbols: {
		test_read: { args: [FFIType.u32], returns: FFIType.i64 },
		test_delete: { args: [FFIType.u32], returns: FFIType.i64 },
	},
});
const readStatus = (error: number) => Number(lib.symbols.test_read(error));
const deleteStatus = (error: number) => Number(lib.symbols.test_delete(error));

describe("the keychain status mapping is the real C, not a JS copy", () => {
	test("ERROR_NOT_FOUND stays the 'nothing stored' sentinel for each caller", () => {
		expect(readStatus(1168)).toBe(-1);
		expect(deleteStatus(1168)).toBe(0);
	});

	test("access denied is a refusal, not a successful no-op", () => {
		expect(readStatus(5)).toBe(-3);
		expect(deleteStatus(5)).toBe(-1);
	});

	test("any other store error is a refusal too", () => {
		expect(readStatus(0)).toBe(-3);
		expect(deleteStatus(0)).toBe(-1);
	});
});

describe("the shim actually uses that mapping on both refusal paths", () => {
	test("get and delete read last-error and pass distinct sentinels", () => {
		expect(source).toContain("shim_keychain_status(getLastError(), -1, SHIM_KC_REFUSED)");
		expect(source).toContain("shim_keychain_status(getLastError(), 0, -1)");
	});
	test("GetLastError is resolved at runtime, never an imported symbol", () => {
		expect(source).not.toMatch(/^extern [^;]*GetLastError/m);
		expect(source).toContain('GetProcAddress(kernel, "GetLastError")');
	});
});
