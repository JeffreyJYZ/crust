/**
 * The C cannot run on macOS, but the cache gate is pure filesystem work and runs everywhere. Each
 * hostile case plants the exact path the launcher would compile from and proves the launcher refuses
 * it instead of handing its bytes to `cc()`.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	assertPrivateSource,
	materialiseNativeSource,
	nativeSourcePath,
	sourceOwner,
} from "./native-source.ts";

const SOURCE = "int shim_ok(void) { return 1; }\n";
const HOSTILE = "int shim_ok(void) { system(\"id\"); return 1; }\n";

function scratch(): string {
	return mkdtempSync(join(tmpdir(), "crust-native-source-"));
}

describe("native source cache", () => {
	test("publishes a private 0600 file and reuses the same path", () => {
		const dir = scratch();
		const path = materialiseNativeSource("probe", SOURCE, dir);
		expect(readFileSync(path, "utf8")).toBe(SOURCE);
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(statSync(dir).mode & 0o777).toBe(0o700);
		expect(materialiseNativeSource("probe", SOURCE, dir)).toBe(path);
	});

	test("HOSTILE FILE: a planted file at the hashed path is refused, not compiled or replaced", () => {
		const dir = scratch();
		const path = nativeSourcePath("probe", SOURCE, dir);
		writeFileSync(path, HOSTILE, { mode: 0o600 });
		expect(() => materialiseNativeSource("probe", SOURCE, dir)).toThrow(
			"does not match the shipped source; refusing to compile it",
		);
		// The attacker's bytes are still there; nothing was handed to the compiler.
		expect(readFileSync(path, "utf8")).toBe(HOSTILE);
	});

	test("HOSTILE SYMLINK: existsSync would follow it, lstat refuses it", () => {
		const dir = scratch();
		const target = join(dir, "elsewhere.c");
		writeFileSync(target, HOSTILE, { mode: 0o600 });
		symlinkSync(target, nativeSourcePath("probe", SOURCE, dir));
		expect(() => materialiseNativeSource("probe", SOURCE, dir)).toThrow("symlinked native source");
	});

	test("a file owned by another uid is refused", () => {
		expect(() =>
			assertPrivateSource("/cache/probe.c", {
				symlink: false,
				regular: true,
				uid: sourceOwner() + 1,
				mode: 0o600,
			}),
		).toThrow("belongs to uid");
	});

	test("a group or world writable file is refused", () => {
		const dir = scratch();
		const path = materialiseNativeSource("probe", SOURCE, dir);
		chmodSync(path, 0o666);
		expect(() => materialiseNativeSource("probe", SOURCE, dir)).toThrow("writable by group");
	});
});
