/**
 * What the notification + tray C unit says about itself, read off its own source.
 *
 * These are read-from-code claims, not measurements: nothing here runs Win32. What they do prove is
 * that the unit cannot quietly acquire the three things this layer must not have — a second message
 * pump, a `NOTIFYICONDATAW` that crosses `bun:ffi`, or a bound entry point nobody classified.
 */
import { describe, expect, test } from "bun:test";
import {
	NOTIFY_TRAY_PART_NAMES,
	NOTIFY_TRAY_PART_PATHS,
	NOTIFY_TRAY_PARTS,
	notifyTraySource,
	readNotifyTrayPart,
} from "./notify-tray-source.ts";
import { NOTIFY_TRAY_PREFLIGHT } from "./notify-tray-ffi.ts";

const SHARED = readNotifyTrayPart("60_notify_tray.c");
const NOTIFY = readNotifyTrayPart("61_notify.c");
const TRAY = readNotifyTrayPart("62_tray.c");
const ALL = `${SHARED}\n${NOTIFY}\n${TRAY}`;
/** The same text with its `//` comment lines dropped, for the assertions about what the code calls. */
const CODE = ALL.split("\n")
	.filter((line) => !line.trim().startsWith("//"))
	.join("\n");

describe("the unit's parts", () => {
	test("three parts, in the order the statics need", () => {
		expect(NOTIFY_TRAY_PART_NAMES).toEqual(["60_notify_tray.c", "61_notify.c", "62_tray.c"]);
		expect(NOTIFY_TRAY_PART_PATHS).toHaveLength(3);
		expect(NOTIFY_TRAY_PARTS).toHaveLength(3);
	});

	test("the embedded source is the parts, joined and LF-only", () => {
		expect(notifyTraySource).toBe(NOTIFY_TRAY_PARTS.join("\n"));
		expect(notifyTraySource).not.toContain("\r");
		expect(NOTIFY_TRAY_PARTS[0]).toBe(SHARED);
	});

	test("nothing is linked: the only imports are the two that resolve", () => {
		// `cc()` links nothing, so an `#include` or a third `extern` import is a load-time fault.
		expect(CODE).not.toContain("#include");
		const externs = [...CODE.matchAll(/^extern .*?(\w+)\(/gm)].map((match) => match[1]);
		expect(externs).toEqual(["LoadLibraryA", "GetProcAddress"]);
	});
});

describe("the pump", () => {
	/**
	 * The hidden window is dispatched by the app's own `shim_pump`, because `DispatchMessageW` is
	 * thread-wide. A second `PeekMessageW` loop here would steal every message from the first.
	 */
	test("the unit never peeks or dispatches messages itself", () => {
		expect(CODE).not.toContain("PeekMessageW");
		expect(CODE).not.toContain("DispatchMessageW");
		expect(TRAY).toContain("DefWindowProcW(hwnd, msg, wp, lp)");
	});
});

describe("NOTIFYICONDATAW", () => {
	test("is built on the C stack, never allocated and never passed to bun:ffi", () => {
		expect(ALL).toContain("shim_nid nid;");
		expect(CODE).not.toContain("malloc");
		// The size the shell validates is the struct's own, so a layout change cannot leave cbSize
		// at a stale constant: the icon, the balloon, the tooltip and the delete each build one.
		expect(ALL.match(/nid\.cbSize = \(unsigned int\)sizeof\(nid\);/g)?.length).toBe(4);
	});

	test("the balloon is NIF_INFO on NIM_MODIFY, and nothing else", () => {
		expect(SHARED).toContain("#define SHIM_NIF_INFO 16u");
		expect(NOTIFY).toContain("nid.uFlags = SHIM_NIF_INFO;");
		expect(NOTIFY).toContain("Shell_NotifyIconW(SHIM_NIM_MODIFY, &nid)");
		expect(NOTIFY).toContain("nid.szInfoTitle");
	});

	test("the menu is modal with TPM_RETURNCMD, so a click is a number", () => {
		expect(TRAY).toContain("SHIM_TPM_RETURNCMD");
		expect(TRAY).toContain("TrackPopupMenu(");
		// Both halves of the documented dismissal fix.
		expect(TRAY).toContain("SetForegroundWindow(hwnd);");
		expect(TRAY).toContain("PostMessageW(hwnd, SHIM_WM_NULL, 0, 0);");
	});
});

describe("the entry points the C binds", () => {
	/**
	 * Every `SHIM_BIND(module, Name)` has a preflight entry naming the same module, and every entry
	 * names a symbol the C still binds. A new call cannot arrive unclassified, and a deleted one
	 * cannot leave a stale row claiming a remedy for something nobody calls.
	 */
	test("are exactly the preflight table, module for module", () => {
		const modules: Record<string, string> = { user32: "user32.dll", shell32: "shell32.dll" };
		// Anchored at the indented call site, so the `#define SHIM_BIND(module, name)` header itself is
		// not read as a binding.
		const bound = [...CODE.matchAll(/^\tSHIM_BIND\((\w+), (\w+)\)/gm)].map(
			(match) => `${modules[match[1] ?? ""] ?? match[1]}!${match[2]}`,
		);
		const listed = NOTIFY_TRAY_PREFLIGHT.map((entry) => `${entry.module}!${entry.symbol}`);
		expect(bound.sort()).toEqual(listed.sort());
	});

	test("each one says what breaks without it", () => {
		for (const entry of NOTIFY_TRAY_PREFLIGHT) {
			expect(entry.breaks.length).toBeGreaterThan(10);
		}
	});
});
