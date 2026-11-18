/**
 * The import seam: `cc()` links nothing, and every Win32 entry point is a pointer resolved at
 * runtime. Nothing else can check that on a machine without user32, so the unit's own source is
 * read here.
 *
 * What forced this (2026-11-16, `09dbdf1`): with the libraries linked through `library:`, the shim
 * compiled and then the first call jumped to `0xFFFFFFFFFFFFFFFF` — a bad import thunk. The dynamic
 * route has no thunk, which is why the design changed rather than the argument list.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SHIM_CC_OPTIONS, tccCommand } from "./ffi.ts";
import { PREFLIGHT } from "./preflight.ts";
import { lf, readShimPart, SHIM_PART_NAMES } from "./shim-source.ts";

const DIR = import.meta.dir;
const SHIM = join(DIR, "shim");

/** Every `.c` part, in the order the unit compiles. */
function parts(): string[] {
	return SHIM_PART_NAMES.map(readShimPart);
}

const source = parts().join("\n");
const binding = lf(readFileSync(join(DIR, "ffi.ts"), "utf8"));

/** Win32 names the unit calls, as opposed to the two imports that do the resolving. */
const RESOLVERS = ["LoadLibraryA", "GetProcAddress"];

/** `static <ret> (*Name)(` — a pointer the unit must bind before it is called. */
function declaredPointers(): string[] {
	return [...source.matchAll(/^static [^(]*\(\*([A-Za-z_]\w*)\)\(/gm)].map(
		(match) => match[1] ?? "",
	);
}

/** `SHIM_BIND(module, Name)` — the one place a pointer is given its address. */
function boundNames(): string[] {
	return [...source.matchAll(/SHIM_BIND\(g_\w+,\s*([A-Za-z_]\w*)\)/g)].map(
		(match) => match[1] ?? "",
	);
}

describe("what the unit imports", () => {
	test("is exactly the two resolvers, both kernel32", () => {
		const imports = [...source.matchAll(/^extern [^;]*?([A-Za-z_]\w*)\(/gm)].map(
			(match) => match[1] ?? "",
		);
		expect(imports.sort()).toEqual([...RESOLVERS].sort());
	});

	test("links no library and passes no flag, so there is no import thunk to get wrong", () => {
		// The prose above `compile()` names `library` and `-L` to explain why they are gone, so the
		// assertions are about the call itself rather than about the file's text.
		const call = binding.slice(binding.indexOf("cc({"));
		expect(call).not.toContain("library:");
		expect(call).not.toContain("flags:");
		expect(call).not.toContain("-luser32");
		expect(call).not.toContain("-L");
	});

	test("every Win32 entry point is a pointer, never a call to an unresolved symbol", () => {
		const pointers = declaredPointers();
		// A floor, not a fixed count: every namespace a lane adds brings its own pointers, and
		// three lanes were adding them at once (2026-11-18). What keeps the table honest is the
		// exhaustive half of `abi-width.test.ts` and the bind-exactly-once test below, not this
		// number — so this asserts the table never *shrinks* under the window/WebView2 layer.
		expect(pointers.length).toBeGreaterThanOrEqual(32);
		expect(pointers).toContain("SetWindowPos");
		expect(pointers).toContain("GetWindowRect");
		expect(pointers).toContain("SetForegroundWindow");
		expect(pointers).toContain("EnumDisplayMonitors");
		expect(pointers).toContain("GetMonitorInfoW");
		expect(pointers).toContain("CreateWindowExW");
		expect(pointers).toContain("PeekMessageW");
		expect(pointers).toContain("CoInitializeEx");
		expect(pointers).toContain("LoadLibraryW");
		// The clipboard/opener/`os.info` table, resolved the same way and from three more modules.
		expect(pointers).toContain("OpenClipboard");
		expect(pointers).toContain("ShellExecuteW");
		expect(pointers).toContain("RtlGetVersion");
		// The style, placement and pointer table, all user32.
		expect(pointers).toContain("GetWindowLongPtrW");
		expect(pointers).toContain("SetWindowLongPtrW");
		expect(pointers).toContain("GetWindowPlacement");
		expect(pointers).toContain("SetLayeredWindowAttributes");
		expect(pointers).toContain("SetCursor");
		expect(pointers).toContain("ShowCursor");
		expect(pointers).toContain("MonitorFromWindow");
		// `GetWindowLongW` is 32-bit and must never be bound: the pointer-sized call is the only one.
		expect(pointers).not.toContain("GetWindowLongW");
		for (const name of RESOLVERS) expect(pointers).not.toContain(name);
	});

	/**
	 * A declared pointer nobody binds is a null call at runtime, and it is the one mistake this
	 * design makes easy. Both directions are checked, so a bind with no declaration also fails.
	 */
	test("every declared pointer is bound exactly once", () => {
		const declared = declaredPointers().sort();
		const bound = boundNames().sort();
		expect(bound).toEqual(declared);
	});
});

describe("the modules the preflight promises", () => {
	/**
	 * The preflight names modules, and the unit must actually load each one. A preflight entry for a
	 * module nothing calls LoadLibraryA on is a check that passes while the call fails.
	 */
	test("are each loaded by name", () => {
		const loaded = [...source.matchAll(/LoadLibraryA\("([\w.]+)"\)/g)].map(
			(match) => match[1] ?? "",
		);
		const expected = [...new Set(PREFLIGHT.map((entry) => entry.module))].filter(
			(module) => module !== "WebView2Loader.dll",
		);
		// Set equality, not multiset: two parts may load the same module for their own entry points
		// (shell32 is both the file panels' and `ShellExecuteW`'s), and what the preflight promises is
		// that a module is loaded at all.
		expect([...new Set(loaded)].sort()).toEqual(expected.sort());
	});
});

describe("the command line a failure prints", () => {
	const source_ = "C:\\Temp\\crust-windows-shim-abc123.c";

	// Nothing is linked, so the line names the source and the options and stops there.
	test("is the equivalent tcc invocation, in one fixed shape", () => {
		expect(tccCommand(source_)).toBe(`tcc ${SHIM_CC_OPTIONS} ${source_}`);
	});
});
