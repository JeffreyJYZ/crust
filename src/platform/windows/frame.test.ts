/**
 * **The frame rule, as a test.** The scan itself lives in `frames.ts`, with the reason it exists; this
 * file is only the assertions, and the reason it is a test rather than a comment is that a comment
 * cannot fail a build.
 *
 * Measured on `windows-latest` (2026-11-16): a 2048-byte local answered 1 and a 4096-byte one died in
 * its own prologue. So a local array at or above 4096 bytes may never appear in this unit again.
 */
import { describe, expect, test } from "bun:test";
import { FRAME_LIMIT, localArrays, offences, unitArrays } from "./frames.ts";
import { readShimPart } from "./shim-source.ts";

/**
 * `48_keychain.c` is its own translation unit (`keychain-ffi.ts` compiles it alone), so
 * `unitArrays()` never sees it. `kc_wchar` is `unsigned short`, the same 2-byte width as the
 * scanner's `shim_wchar`, so normalising the typedef name lets the same rule measure this file.
 */
const keychain = (source: string) => {
	const max = /#define SHIM_KC_TARGET_MAX (\d+)/.exec(source)?.[1] ?? "?";
	return localArrays(
		"48_keychain.c",
		source.replaceAll("kc_wchar", "shim_wchar").replaceAll("SHIM_KC_TARGET_MAX", max),
	);
};

describe("frame size", () => {
	test("no local array in the unit reaches 4096 bytes", () => {
		expect(offences(unitArrays())).toEqual([]);
	});

	test("the scan measures the arrays it finds, rather than passing on an empty list", () => {
		const entries = unitArrays();
		expect(entries.length).toBeGreaterThanOrEqual(8);
		expect(entries.filter((entry) => entry.bytes === undefined)).toEqual([]);
		// 1024 UTF-16 code units: the user-data folder in `shim_env_begin`.
		const dir = entries.find((entry) => entry.text === "shim_wchar dir[1024]");
		expect(dir?.bytes).toBe(2048);
	});

	test("the guard bites at 4096 bytes in each element shape", () => {
		const source = (type: string, bound: number): string =>
			`int f(void) {\n\t${type} buf[${bound}];\n\treturn buf[0];\n}\n`;
		expect(offences(localArrays("x.c", source("unsigned char", 4096))).length).toBe(1);
		expect(offences(localArrays("x.c", source("shim_wchar", 2048))).length).toBe(1);
		expect(offences(localArrays("x.c", source("int", 1024))).length).toBe(1);
		// One byte under the threshold is still the inline prologue.
		expect(offences(localArrays("x.c", source("unsigned char", 4095)))).toEqual([]);
		expect(localArrays("x.c", source("shim_wchar", 2048))[0]?.bytes).toBe(FRAME_LIMIT);
	});

	test("storage that costs no frame is skipped", () => {
		const fileScope = "static shim_wchar g_url[2048];\n";
		const localStatic = "int f(void) {\n\tstatic shim_wchar buf[4096];\n\treturn buf[0];\n}\n";
		const structBody = "typedef struct {\n\tshim_wchar name[4096];\n} S;\n";
		const inComment = "// a shim_wchar x[4096] would be the bug\nint f(void) { return 0; }\n";
		expect(localArrays("x.c", fileScope)).toEqual([]);
		expect(localArrays("x.c", localStatic)).toEqual([]);
		expect(localArrays("x.c", structBody)).toEqual([]);
		expect(localArrays("x.c", inComment)).toEqual([]);
	});

	test("an unmeasurable type or bound fails instead of passing silently", () => {
		const unknownType = "int f(void) {\n\tshim_rect buf[4096];\n\treturn 0;\n}\n";
		const unknownBound = "int f(void) {\n\tunsigned char buf[SHIM_MAX];\n\treturn 0;\n}\n";
		expect(offences(localArrays("x.c", unknownType)).length).toBe(1);
		expect(offences(localArrays("x.c", unknownBound)).length).toBe(1);
	});

	test("a pointer, second bound, initialiser or second declarator is not skipped", () => {
		const scan = (decl: string) =>
			localArrays("x.c", `int f(void) {\n\t${decl};\n\treturn 0;\n}\n`);
		for (const decl of [
			"void *p[512]",
			"shim_wchar *p[2048]",
			"char *p[4096]",
			"const shim_wchar *p[2048]",
			"shim_wchar buf[64][64]",
			"unsigned char buf[4096] = {0}",
		]) {
			expect(offences(scan(decl)).length, decl).toBe(1);
		}
		const two = scan("shim_wchar a[2048], b[2048]");
		expect(two.map((entry) => entry.bytes)).toEqual([4096, 4096]);
		expect(offences(two).length).toBe(2);
	});

	test("an array-element assignment is not read as a declaration", () => {
		const source = "int f(void) {\n\tdst[n - 1] = 0;\n\treturn 0;\n}\n";
		expect(localArrays("x.c", source)).toEqual([]);
	});

	test("the probe that must crash is gone, and the positive control stays", () => {
		const probe = readShimPart("36_probe.c");
		expect(probe).toContain("int shim_frame_probe_small(void)");
		expect(probe).not.toContain("shim_frame_probe_large");
	});

	test("the separately-compiled keychain unit obeys the same frame rule", () => {
		const source = readShimPart("48_keychain.c");
		expect(source).toContain("static kc_wchar target[SHIM_KC_TARGET_MAX]");
		expect(offences(keychain(source))).toEqual([]);
		// The guard is real: drop `static` on the four scratch buffers and the same scan catches all
		// four 4096-byte frames that used to emit the unresolved `call __chkstk`.
		const asLocals = source.replace(/\bstatic kc_wchar (target|prefix)\[/g, "kc_wchar $1[");
		const caught = keychain(asLocals);
		expect(caught.length).toBe(4);
		expect(caught.every((entry) => entry.bytes === FRAME_LIMIT)).toBe(true);
	});

	test("the keychain scan bites at 4096 bytes on that file's 2-byte type", () => {
		const probe = (bound: number): string =>
			`int shim_keychain_probe(void) {\n\tkc_wchar buf[${bound}];\n\treturn buf[0];\n}\n`;
		const large = keychain(probe(2048));
		expect(large[0]?.bytes).toBe(FRAME_LIMIT);
		expect(offences(large).length).toBe(1);
		expect(offences(keychain(probe(2047)))).toEqual([]);
	});
});
