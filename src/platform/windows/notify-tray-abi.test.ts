/**
 * The ABI of the two structs the notification area reads, measured rather than asserted.
 *
 * A wrong offset here is silent: the shell validates `cbSize`, then reads `szInfo` at the offset it
 * knows, so a struct that packs differently shows the tooltip where the balloon body should be. The
 * declarations are sliced out of the shipped part and compiled as they are, so this test moves when
 * the C moves.
 *
 * The measurement is the host ABI (arm64/x86-64 macOS or Linux here), not Windows — both are LP64
 * with 8-byte pointers and 4-byte `int`, which is exactly the alignment `NOTIFYICONDATAW` depends
 * on. It is the closest thing to a Windows check that can run on this machine, and it is labelled as
 * such rather than presented as a Windows measurement.
 */
import { describe, expect, test } from "bun:test";
import { cc, FFIType } from "bun:ffi";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readNotifyTrayPart } from "./notify-tray-source.ts";

const PART = readNotifyTrayPart("60_notify_tray.c");
const OPEN = "typedef void *shim_h;";
const CLOSE = "} shim_nid;";
const DECLS = PART.slice(PART.indexOf(OPEN), PART.indexOf(CLOSE) + CLOSE.length);

/** The real declarations, plus one probe that reports a size or a field offset. */
const SOURCE = [
	DECLS,
	"static shim_nid g_nid;",
	"static shim_wndclass g_wc;",
	"#define SHIM_AT(base, field) ((unsigned long long)((char *)&(base).field - (char *)&(base)))",
	"unsigned long long abi_num(int which) {",
	"  switch (which) {",
	"  case 0: return sizeof(shim_nid);",
	"  case 1: return SHIM_AT(g_nid, hWnd);",
	"  case 2: return SHIM_AT(g_nid, szTip);",
	"  case 3: return SHIM_AT(g_nid, szInfo);",
	"  case 4: return SHIM_AT(g_nid, szInfoTitle);",
	"  case 5: return SHIM_AT(g_nid, dwInfoFlags);",
	"  case 6: return SHIM_AT(g_nid, hBalloonIcon);",
	"  case 7: return sizeof(shim_wndclass);",
	"  case 8: return SHIM_AT(g_wc, lpfnWndProc);",
	"  case 9: return SHIM_AT(g_wc, lpszClassName);",
	"  default: return 0;",
	"  }",
	"}",
].join("\n");

const path = join(tmpdir(), "crust-notify-tray-abi.c");
writeFileSync(path, SOURCE);
const { symbols } = cc({
	source: path,
	symbols: { abi_num: { args: [FFIType.i32], returns: FFIType.u64 } },
});
const at = (which: number): number => Number(symbols.abi_num(which));

describe("NOTIFYICONDATAW, as the compiler lays it out", () => {
	test("is 976 bytes, the size the shell validates", () => {
		expect(at(0)).toBe(976);
	});

	test("every field the shell reads sits where Windows reads it", () => {
		// hWnd after cbSize plus the ABI's 4 bytes of padding; the three string arrays are the ones
		// whose offsets a packing change would move.
		expect({
			hWnd: at(1),
			szTip: at(2),
			szInfo: at(3),
			szInfoTitle: at(4),
			dwInfoFlags: at(5),
			hBalloonIcon: at(6),
		}).toEqual({
			hWnd: 8,
			szTip: 40,
			szInfo: 304,
			szInfoTitle: 820,
			dwInfoFlags: 948,
			hBalloonIcon: 968,
		});
	});
});

describe("WNDCLASSEXW, as the compiler lays it out", () => {
	test("is 80 bytes with the procedure at 8 and the class name at 64", () => {
		expect({ size: at(7), lpfnWndProc: at(8), lpszClassName: at(9) }).toEqual({
			size: 80,
			lpfnWndProc: 8,
			lpszClassName: 64,
		});
	});
});
