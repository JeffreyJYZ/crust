/**
 * The return width of every Win32 entry point the shim calls, read off the unit's own source.
 *
 * Nothing else can check this on a machine without user32: the prelude declares each entry point as
 * a function pointer, and a pointer declared wider than the real function reads an undefined top half
 * of RAX. `CoInitializeEx` was declared `shim_i64` for a 32-bit `HRESULT`, so a sign-extended `S_OK`
 * reached `platform.ts`'s `hr < 0` test and would have refused a healthy machine (found by the
 * 2026-11-16 audit; `CoGetApartmentType` had already been corrected the same way).
 *
 * The three tables below are exhaustive on purpose: a new entry point has to be given a width verdict
 * here before the unit will pass, which is the only way the audit survives the next function added.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hresult } from "./platform-config.ts";
import { readShimPart } from "./shim-source.ts";

const PRELUDE = `${readShimPart("10_prelude.c")}\n${readShimPart("11_pointer_core.c")}\n${readShimPart("11_win32_style.c")}`;
const BINDING = readFileSync(join(import.meta.dir, "ffi.ts"), "utf8");

/** `static <ret> (*Name)(` — the return type with its line breaks collapsed to single spaces. */
function declaredReturns(): Map<string, string> {
	const returns = new Map<string, string>();
	for (const match of PRELUDE.matchAll(/^static ([^;]*?)\(\*([A-Za-z_]\w*)\)\(/gm)) {
		returns.set(match[2] ?? "", (match[1] ?? "").replace(/\s+/g, " ").trim());
	}
	return returns;
}

/**
 * A 32-bit return: `HRESULT`, `BOOL`, `int`, `UINT`, `DWORD`. `long` is 32-bit on Windows even at
 * x64, which is why `HRESULT` lands here and `LRESULT` does not.
 */
const THIRTY_TWO: Record<string, string> = {
	CoInitializeEx: "int", // HRESULT — the defect this file exists for
	CoGetApartmentType: "int", // HRESULT
	DestroyWindow: "int", // BOOL
	IsWindow: "int", // BOOL
	ShowWindow: "int", // BOOL
	UpdateWindow: "int", // BOOL
	GetClientRect: "int", // BOOL
	GetWindowRect: "int", // BOOL
	SetWindowPos: "int", // BOOL
	IsIconic: "int", // BOOL
	IsZoomed: "int", // BOOL
	SetForegroundWindow: "int", // BOOL
	SetWindowTextW: "int", // BOOL
	PeekMessageW: "int", // BOOL
	PostMessageW: "int", // BOOL — PostMessageW returns BOOL, not the LRESULT PostQuitMessage lacks
	TranslateMessage: "int", // BOOL
	MultiByteToWideChar: "int", // int
	GetLastError: "unsigned int", // DWORD
	GetCurrentThreadId: "unsigned int", // DWORD
	GetWindowThreadProcessId: "unsigned int", // DWORD
	// The style and pointer calls: BOOL returns. `GetWindowLongPtrW` is NOT here — it is
	// pointer-sized, which is the whole reason the `…Ptr` call exists.
	SetLayeredWindowAttributes: "int", // BOOL
	GetLayeredWindowAttributes: "int", // BOOL
	GetWindowPlacement: "int", // BOOL
	ShowCursor: "int", // int — the count, not a boolean
	// `11_pointer_core.c`: the clipboard, the locale and the version call.
	OpenClipboard: "int", // BOOL
	CloseClipboard: "int", // BOOL
	EmptyClipboard: "int", // BOOL
	GlobalUnlock: "int", // BOOL
	WideCharToMultiByte: "int", // int — the UTF-8 length, or 0
	RtlGetVersion: "int", // LONG/NTSTATUS — 0 is success, and it is 32-bit even at x64
	GetUserDefaultLocaleName: "int", // int — characters written, 0 on failure
};

/** A 16-bit return, which zero-extends and must still not be declared wide. */
const SIXTEEN: Record<string, string> = {
	RegisterClassExW: "unsigned short", // ATOM
};

/** A genuinely 64-bit return: `HANDLE`/`HMODULE`/`LRESULT`/`SIZE_T`/`ULONGLONG`/a pointer. */
const SIXTY_FOUR: Record<string, string> = {
	GetTickCount64: "unsigned long long", // ULONGLONG
	VirtualQuery: "unsigned long long", // SIZE_T
	EnumDisplayMonitors: "int", // BOOL — the screen plugin enumerates monitors
	GetMonitorInfoW: "int", // BOOL
	DispatchMessageW: "shim_i64", // LRESULT
	DefWindowProcW: "shim_i64", // LRESULT
	LoadLibraryW: "shim_h", // HMODULE
	GetModuleHandleW: "shim_h", // HMODULE
	LoadCursorW: "shim_h", // HCURSOR
	CreateWindowExW: "shim_h", // HWND
	// `11_pointer_core.c`: handles and the shell's HINSTANCE, none of them an int.
	GetClipboardData: "shim_h", // HANDLE
	SetClipboardData: "shim_h", // HANDLE
	GlobalAlloc: "shim_h", // HGLOBAL
	GlobalLock: "shim_h", // LPVOID
	GlobalFree: "shim_h", // HGLOBAL
	ShellExecuteW: "shim_h", // HINSTANCE — compared against 32, never read as an HRESULT
	// `11_win32_style.c`: the pointer-sized `…Ptr` call and the three handle returns. Declaring
	// `GetWindowLongPtrW` as `int` truncates a LONG_PTR; declaring it wide is the whole point.
	GetWindowLongPtrW: "shim_i64", // LONG_PTR
	SetWindowLongPtrW: "shim_i64", // LONG_PTR — the previous value
	SetCursor: "shim_h", // HCURSOR — the previous cursor
	MonitorFromWindow: "shim_h", // HMONITOR
};

/** No return at all, so no width to get wrong. */
const VOID: Record<string, string> = {
	Sleep: "void",
	PostQuitMessage: "void",
};

const TABLES = [THIRTY_TWO, SIXTEEN, SIXTY_FOUR, VOID];

describe("the return width of every Win32 entry point", () => {
	test("a 32-bit return is declared 32-bit", () => {
		const returns = declaredReturns();
		for (const [name, type] of Object.entries(THIRTY_TWO)) {
			// Named individually so a failure says which entry point, and what it read instead.
			expect({ [name]: returns.get(name) }).toEqual({ [name]: type });
		}
	});

	test("an ATOM is declared as the 16-bit value it is", () => {
		const returns = declaredReturns();
		for (const [name, type] of Object.entries(SIXTEEN)) {
			expect({ [name]: returns.get(name) }).toEqual({ [name]: type });
		}
	});

	test("a genuinely 64-bit return stays 64-bit or a pointer", () => {
		const returns = declaredReturns();
		for (const [name, type] of Object.entries(SIXTY_FOUR)) {
			expect({ [name]: returns.get(name) }).toEqual({ [name]: type });
		}
	});

	test("a void return is declared void", () => {
		const returns = declaredReturns();
		for (const [name, type] of Object.entries(VOID)) {
			expect({ [name]: returns.get(name) }).toEqual({ [name]: type });
		}
	});

	/**
	 * The exhaustive half: every pointer the prelude declares has a verdict above, and every verdict
	 * above names a pointer the prelude still declares. A new entry point therefore cannot arrive
	 * without someone deciding its width.
	 */
	test("every declared pointer is classified, and every classification is declared", () => {
		const classified = TABLES.flatMap((table) => Object.keys(table)).sort();
		expect([...declaredReturns().keys()].sort()).toEqual(classified);
	});
});

describe("the widening point at the bun:ffi boundary", () => {
	/**
	 * `shim_com_init` returns `shim_i64`, so the sign of a failed `HRESULT` survives the trip to
	 * JavaScript. Declared `i32` here, the value would arrive unsigned and `hr < 0` would never fire.
	 */
	test("shim_com_init is widened to i64 at the export", () => {
		expect(BINDING).toContain("shim_com_init: { args: [], returns: I64 },");
	});

	/** The reach: a sign-extended failure reads as the hex a Windows developer recognises. */
	test("a failed HRESULT still reads negative, and prints as 0x80004005", () => {
		const eFail = -2147467259; // 0x80004005, sign-extended from the 32-bit return
		expect(eFail).toBeLessThan(0);
		expect(hresult(eFail)).toBe("0x80004005");
	});
});
