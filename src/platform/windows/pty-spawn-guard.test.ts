/**
 * Spawn-input guards on the ConPTY unit, split from `pty-source.test.ts` at the 200-line cap. Both
 * defects lose what the page asked for without a refusal: an over-long argument string used to be
 * dropped after the shell started, and the plugin's environment used to be discarded entirely.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readPtyPart } from "./pty-source.ts";

const OPEN = readPtyPart("65_pty_open.c");

describe("spawn inputs", () => {
	test("an argument string that does not fit fails the spawn instead of vanishing", () => {
		expect(OPEN).toContain("if (extra < 0) {");
		const at = OPEN.indexOf("if (extra < 0) {");
		const branch = OPEN.slice(at, OPEN.indexOf("return -1;", at));
		for (const cleanup of [
			"DeleteProcThreadAttributeList(list)",
			"HeapFree(heap, 0, list)",
			"ClosePseudoConsole(console)",
			"CloseHandle(in_write)",
			"CloseHandle(out_read)",
		])
			expect(branch).toContain(cleanup);
	});

	test("the FFI carries the environment pointer, so the plugin's env is not dropped", () => {
		expect(OPEN).toContain(
			"int shim_pty_open(const char *shell, const char *args, const char *cwd, const shim_wchar *env,",
		);
		const ffi = readFileSync(join(import.meta.dir, "pty-ffi.ts"), "utf8");
		expect(ffi).toContain("shim_pty_open: { args: [CS, CS, CS, P, I32, I32], returns: I32 }");
	});
});
