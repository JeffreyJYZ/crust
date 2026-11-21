/**
 * What the ConPTY C unit says about itself, read off its own source.
 *
 * These are read-from-code claims, not measurements: nothing here runs Win32. What they do prove is
 * that the unit cannot quietly acquire the things this layer must not have — a second message pump,
 * a `STARTUPINFOEXW` that crosses `bun:ffi`, a spawn without the console attribute, or a bound
 * entry point nobody classified. The Windows runner's `scripts/windows/pty.ts` is the measurement.
 */
import { describe, expect, test } from "bun:test";
import { FRAME_LIMIT, localArrays, offences } from "./frames.ts";
import { PTY_PART_NAMES, PTY_PART_PATHS, PTY_PARTS, ptySource, readPtyPart } from "./pty-source.ts";
import { PTY_PREFLIGHT } from "./pty-ffi.ts";

const CONTRACT = readPtyPart("63_pty.c");
const BINDS = readPtyPart("64_pty_bind.c");
const OPEN = readPtyPart("65_pty_open.c");
const IO = readPtyPart("66_pty_io.c");
const ALL = `${CONTRACT}\n${BINDS}\n${OPEN}\n${IO}`;
/** The same text with its `//` comment lines dropped, for the assertions about what the code calls. */
const CODE = ALL.split("\n")
	.filter((line) => !line.trim().startsWith("//"))
	.join("\n");

describe("the unit's parts", () => {
	test("four parts, in the order the statics need", () => {
		expect(PTY_PART_NAMES).toEqual([
			"63_pty.c",
			"64_pty_bind.c",
			"65_pty_open.c",
			"66_pty_io.c",
		]);
		expect(PTY_PART_PATHS).toHaveLength(4);
		expect(PTY_PARTS).toHaveLength(4);
	});

	test("the embedded source is the parts, joined and LF-only", () => {
		expect(ptySource).toBe(PTY_PARTS.join("\n"));
		expect(ptySource).not.toContain("\r");
		expect(PTY_PARTS[0]).toBe(CONTRACT);
	});

	test("nothing is linked: the only imports are the two that resolve", () => {
		// `cc()` links nothing, so an `#include` or a third `extern` import is a load-time fault.
		expect(CODE).not.toContain("#include");
		const externs = [...CODE.matchAll(/^extern .*?(\w+)\(/gm)].map((match) => match[1]);
		expect(externs).toEqual(["LoadLibraryA", "GetProcAddress"]);
	});
});

describe("the pseudo-console", () => {
	test("the child is started on the console it was given, not on one it allocated", () => {
		expect(CODE).toContain("#define SHIM_PTY_ATTRIBUTE 0x00020016ULL");
		expect(CODE).toContain("#define SHIM_PTY_EXTENDED 0x00080000u");
		expect(OPEN).toContain("UpdateProcThreadAttribute(list, 0, SHIM_PTY_ATTRIBUTE, &console");
		expect(OPEN).toContain("CreateProcessW(0, command, 0, 0, 0, SHIM_PTY_EXTENDED, 0, working");
		// `bInheritHandles` is FALSE: the console owns the pipes, not the child's inheritance table.
		expect(OPEN).not.toContain("CreateProcessW(0, command, 0, 0, 1,");
	});

	test("both pipe pairs are created inheritable, so the console host can hold them", () => {
		// Measured on windows-latest 2026-11-21: with default non-inheritable pipes the console and
		// its shell ran, and not one byte reached the read end.
		expect(OPEN).toContain("attrs.bInheritHandle = 1;");
		expect(OPEN).toContain("CreatePipe(&in_read, &in_write, &attrs, 0)");
		expect(OPEN).toContain("CreatePipe(&out_read, &out_write, &attrs, 0)");
		expect(OPEN).toContain("CreatePseudoConsole(size, in_read, out_write, 0, &console)");
	});

	test("every refused open returns before anything else runs on a half-open console", () => {
		const open = OPEN.slice(OPEN.indexOf("int shim_pty_open("));
		const sites = open
			.split("shim_pty_fail(")
			.slice(1)
			.filter((tail) => !tail.startsWith('"the pseudo-console is open"'));
		expect(sites.length).toBeGreaterThanOrEqual(6);
		for (const tail of sites) {
			// The message line, then the cleanup that belongs to that branch, then the -1.
			expect(tail.slice(0, 600)).toContain("return -1;");
		}
	});

	test("both the console's calls are read as HRESULTs, where S_OK is zero", () => {
		// Measured on windows-latest 2026-11-21: `!CreatePseudoConsole(...)` read a successful
		// `S_OK` as a refusal and every `pty.open` answered spawn-failed with no GetLastError.
		expect(CODE).toContain(
			"int opened = CreatePseudoConsole(size, in_read, out_write, 0, &console)",
		);
		expect(CODE).toContain("if (opened < 0)");
		expect(CODE).toContain("int resized = ResizePseudoConsole(slot->console, size)");
		expect(CODE).toContain("if (resized < 0)");
	});

	test("both take COORD by value, because a pointer there is read as the size", () => {
		// The same run: ResizePseudoConsole answered E_INVALIDARG (0x80070057) because the pointer's
		// low 32 bits arrived as the COORD, and CreatePseudoConsole had accepted that garbage size.
		expect(CODE).toContain("static int (*CreatePseudoConsole)(shim_pty_coord size,");
		expect(CODE).toContain(
			"static int (*ResizePseudoConsole)(void *console, shim_pty_coord size)",
		);
		expect(CODE).not.toContain("CreatePseudoConsole)(void *size");
		expect(CODE).not.toContain("ResizePseudoConsole)(void *console, void *size)");
	});

	test("the startup struct and both handle structs stay on the C stack", () => {
		expect(OPEN).toContain("shim_pty_startup startup;");
		expect(OPEN).toContain("shim_pty_info info;");
		expect(CODE).not.toContain("malloc");
	});
});

describe("the frame", () => {
	/**
	 * The same rule `frame.test.ts` enforces on the window unit: at 4096 bytes of locals TinyCC emits
	 * `call __chkstk`, which nothing in this link set defines, so the call lands in `-1` and the
	 * function dies in its own prologue. The shell path and cwd buffers are 1024 bytes each because
	 * of it, not because a path is that long.
	 */
	test("no local array reaches 4096 bytes, and open's arrays together stay below it", () => {
		const entries = PTY_PARTS.flatMap((part, index) =>
			localArrays(PTY_PART_NAMES[index] ?? "pty.c", part),
		);
		expect(offences(entries)).toEqual([]);
		expect(entries.map((entry) => entry.text)).toContain("shim_wchar command[512]");
		const open = entries.filter((entry) => entry.file === "65_pty_open.c");
		const total = open.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0);
		expect(total).toBeGreaterThan(0);
		expect(total).toBeLessThan(FRAME_LIMIT);
	});
});

describe("the reader", () => {
	/**
	 * Output is drained off the JavaScript thread: `ReadFile` on a console pipe blocks until the
	 * child writes, and the thread that pumps the app is not one that may block.
	 */
	test("runs on its own thread and never blocks the caller", () => {
		expect(OPEN).toContain("CreateThread(0, 0, shim_pty_reader, slot, 0, 0)");
		expect(IO).toContain("ReadFile(slot->output, buffer");
		expect(IO).not.toContain("PeekMessageW");
		expect(IO).not.toContain("DispatchMessageW");
	});

	test("a read copies out what arrived and never waits for a line", () => {
		expect(IO).toContain("while (slot->tail != slot->head && count < cap)");
		expect(IO).not.toContain("\\n");
	});

	test("close ends the child before the console, so the pipe break reaches the reader", () => {
		const close = IO.slice(IO.indexOf("int shim_pty_close("));
		expect(close.indexOf("TerminateProcess")).toBeLessThan(close.indexOf("ClosePseudoConsole"));
		expect(close.indexOf("ClosePseudoConsole")).toBeLessThan(
			close.indexOf("CloseHandle(slot->input)"),
		);
	});

	test("the console's own pipe ends are held from open to close, never dropped early", () => {
		expect(OPEN).toContain("slot->console_input = in_read;");
		expect(OPEN).toContain("slot->console_output = out_write;");
		expect(CODE).toContain("if (slot->console_input) CloseHandle(slot->console_input);");
		expect(CODE).toContain("if (slot->console_output) CloseHandle(slot->console_output);");
	});
});

describe("the entry points the C binds", () => {
	test("are exactly the preflight table", () => {
		const bound = [...CODE.matchAll(/^\tSHIM_BIND\((\w+), (\w+)\)/gm)].map(
			(match) => `${match[1]}!${match[2]}`,
		);
		const listed = PTY_PREFLIGHT.map(
			(entry) => `${entry.module.replace(".dll", "")}!${entry.symbol}`,
		);
		expect(bound.sort()).toEqual(listed.sort());
	});

	test("each one names kernel32 and says what breaks without it", () => {
		for (const entry of PTY_PREFLIGHT) {
			expect(entry.module).toBe("kernel32.dll");
			expect(entry.breaks.length).toBeGreaterThan(10);
		}
	});
});
