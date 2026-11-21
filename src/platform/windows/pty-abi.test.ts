/**
 * The ABI of the three structs `CreatePseudoConsole` and `CreateProcessW` read, measured rather
 * than asserted.
 *
 * A wrong offset here is silent: `cb` is validated against `sizeof(STARTUPINFOEXW)`, then
 * `lpAttributeList` is read from where Windows thinks it is — a struct that packs differently
 * starts the child on no console at all, and the only symptom is a shell that never writes. The
 * declarations are sliced out of the shipped part and compiled as they are, so this test moves when
 * the C moves.
 *
 * The measurement is the host ABI (arm64/x86-64 macOS here), not Windows — both are LP64 with
 * 8-byte pointers and 4-byte `int`, which is exactly the alignment these structs depend on. It is
 * the closest thing to a Windows check that can run on this machine, and it is labelled as such.
 */
import { describe, expect, test } from "bun:test";
import { cc, FFIType } from "bun:ffi";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPtyPart } from "./pty-source.ts";

const PART = readPtyPart("63_pty.c");
const OPEN = "// `COORD`: two shorts";
const CLOSE = "} shim_pty_lock;";
const DECLS = PART.slice(PART.indexOf(OPEN), PART.indexOf(CLOSE) + CLOSE.length);

/** The shipped declarations, plus one probe that reports a size or a field offset. */
const SOURCE = [
	"typedef void *shim_h;",
	"typedef unsigned short shim_wchar;",
	"typedef unsigned long long shim_u64;",
	DECLS,
	"static shim_pty_startup g_startup;",
	"#define SHIM_AT(base, field) ((unsigned long long)((char *)&(base).field - (char *)&(base)))",
	"unsigned long long abi_num(int which) {",
	"  switch (which) {",
	"  case 0: return sizeof(shim_pty_startup);",
	"  case 1: return SHIM_AT(g_startup, lpReserved);",
	"  case 2: return SHIM_AT(g_startup, dwFlags);",
	"  case 3: return SHIM_AT(g_startup, wShowWindow);",
	"  case 4: return SHIM_AT(g_startup, lpReserved2);",
	"  case 5: return SHIM_AT(g_startup, hStdInput);",
	"  case 6: return SHIM_AT(g_startup, lpAttributeList);",
	"  case 7: return sizeof(shim_pty_info);",
	"  case 8: return sizeof(shim_pty_coord);",
	"  case 9: return sizeof(shim_pty_lock);",
	"  default: return 0;",
	"  }",
	"}",
].join("\n");

const path = join(tmpdir(), "crust-pty-abi.c");
writeFileSync(path, SOURCE);
const { symbols } = cc({
	source: path,
	symbols: { abi_num: { args: [FFIType.i32], returns: FFIType.u64 } },
});
const at = (which: number): number => Number(symbols.abi_num(which));

describe("STARTUPINFOEXW, as the compiler lays it out", () => {
	test("is 112 bytes: STARTUPINFOW's 104 plus the attribute-list pointer", () => {
		expect(at(0)).toBe(112);
	});

	test("its fields sit at the offsets Windows reads", () => {
		// cb at 0, four bytes, then the pointer; lpReserved is the first pointer at 8.
		expect(at(1)).toBe(8);
		// Eight DWORDs of position/size/fill follow the three pointers, so dwFlags is 60.
		expect(at(2)).toBe(60);
		expect(at(3)).toBe(64);
		// The two extra shorts are 66 bytes in, and the pointer after them is 8-aligned at 72.
		expect(at(4)).toBe(72);
		expect(at(5)).toBe(80);
		expect(at(6)).toBe(104);
	});
});

describe("PROCESS_INFORMATION and the console's own size", () => {
	test("PROCESS_INFORMATION is two handles and two DWORDs", () => {
		expect(at(7)).toBe(24);
	});

	test("COORD is two shorts, which is what CreatePseudoConsole reads", () => {
		expect(at(8)).toBe(4);
	});

	test("CRITICAL_SECTION's 40 bytes are covered by the padding the C declares", () => {
		expect(at(9)).toBe(40);
	});
});
