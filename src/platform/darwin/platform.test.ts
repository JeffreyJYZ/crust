import { describe, expect, test } from "bun:test";
import { ptr } from "bun:ffi";
import {
	DarwinPlatform,
	PANEL_STATUS,
	PREFLIGHT,
	darwinDialogAdapter,
	preflightError,
	shim,
	windowLiveness,
} from "@/platform/darwin/index.ts";
import { createDialogPlugin } from "@/plugins/dialog.ts";
import { isNotImplemented } from "@/plugins/define.ts";

const SHIM_C = `${import.meta.dir}/shim.c`;

/** A `const char *` argument, since a JS string cannot cross into C. */
function cstr(s: string): number {
	return ptr(new TextEncoder().encode(`${s}\0`));
}

describe("darwin shim", () => {
	test("compiles through cc() and links AppKit", () => {
		const compiled = shim();
		expect(typeof compiled.symbols.shim_window_new).toBe("function");
		expect(typeof compiled.symbols.shim_pump).toBe("function");

		// A C call round-trips: shim_cstr_len is a plain strlen. A JS string
		// cannot cross, so the buffer's address is passed; i64 returns BigInt.
		const bytes = new TextEncoder().encode("crust\0");
		expect(Number(compiled.symbols.shim_cstr_len(ptr(bytes)))).toBe(5);
	});

	test("exports the three open-panel symbols", () => {
		const symbols = shim().symbols;
		expect(typeof symbols.shim_open_panel).toBe("function");
		expect(typeof symbols.shim_open_panel_count).toBe("function");
		expect(typeof symbols.shim_open_panel_path).toBe("function");
	});

	/**
	 * The liveness reads are C-side with one fixed prototype each, because they
	 * are the evidence for "this window is gone". A null window is the one input
	 * that must never fault, so every one of them answers 0 for it.
	 */
	test("exports the window liveness reads, each null-safe", () => {
		const symbols = shim().symbols;
		for (const name of [
			"shim_window_number",
			"shim_window_is_visible",
			"shim_window_is_miniaturized",
			"shim_window_is_released_when_closed",
			"shim_window_is_key",
		] as const) {
			expect(typeof symbols[name]).toBe("function");
			expect(Number(symbols[name](0) ?? -1)).toBe(0);
		}
	});

	/**
	 * The non-blocking path with no window. `runModal=0` needs a key window to
	 * sheet on; this process has none, so the shim must refuse before sending
	 * anything — a `-beginSheetModalForWindow:` with a nil window is an ObjC
	 * exception, which is a SIGABRT with no JavaScript error. Nothing here
	 * touches the screen, so no human is needed.
	 */
	test("runModal=0 with no window returns a defined status, not a crash", () => {
		const status = Number(shim().symbols.shim_open_panel(cstr("crust test"), 0, 0, 0) ?? -1);
		expect(Object.values(PANEL_STATUS) as number[]).toContain(status);
		expect([
			PANEL_STATUS.noWindow,
			PANEL_STATUS.unsupported,
			PANEL_STATUS.sheetStarted,
		] as number[]).toContain(status);
		expect(status).not.toBe(PANEL_STATUS.picked);
		// Nothing was collected, so the path accessor is empty out of range.
		expect(Number(shim().symbols.shim_open_panel_count() ?? -1)).toBe(0);
		expect(String(shim().symbols.shim_open_panel_path(0))).toBe("");
	});
});

describe("dialog adapter", () => {
	test("exposes the plugin's hook and the command's name", () => {
		const adapter = darwinDialogAdapter();
		expect(typeof adapter.pickOpen).toBe("function");
		expect(adapter.openPanel).toBe(adapter.pickOpen);
	});

	test("the plugin still answers not-implemented without an adapter", async () => {
		const plugin = createDialogPlugin();
		const result = await plugin.commands.openPanel({});
		expect(isNotImplemented(result)).toBe(true);
		if (isNotImplemented(result)) expect(result.requires).toBe("NSOpenPanel");
	});

	test("the default dialogPlugin stays the adapter-less one", () => {
		// runtime.ts builds the adapted plugin with createDialogPlugin(adapter);
		// the exported default must not smuggle AppKit into a headless process.
		expect(createDialogPlugin).toBeDefined();
	});
});

describe("selector preflight", () => {
	test("every listed selector resolves on this system", () => {
		const failures = PREFLIGHT.map((entry) => preflightError(entry)).filter(
			(error): error is string => error !== undefined,
		);
		expect(failures).toEqual([]);
	});

	test("class_getClassMethod is never used as an existence test", async () => {
		// The ban is structural: no JS-visible symbol reaches it at all, and the C
		// file does not declare it.
		expect(shim().symbols).not.toHaveProperty("shim_class_method");
		expect(shim().symbols).not.toHaveProperty("shim_class_getClassMethod");

		const c = await Bun.file(SHIM_C).text();
		expect(c).not.toContain("class_getClassMethod");
		expect(c).not.toContain("class_getClassMethod(");
		// The intern table and the crash-prone constructor stay deleted: no symbol
		// and no selector literal for either survives in the shim source.
		expect(c).not.toContain('"stringWithUTF8String:');
		expect(c).not.toMatch(/shim_intern_[a-z]+/);
		expect(shim().symbols).not.toHaveProperty("shim_intern_bytes");
	});
});

describe("window liveness", () => {
	/**
	 * The defect this rule exists for: `-windowNumber` never reads 0 after a
	 * close. Measured 2026-11-13 on macOS 27 — `-close` ordered the window out
	 * (`isVisible` 1 → 0 in 1.02 ms, still 0 after 300 ms and after 1 s of
	 * pumping) while the window device number stayed 517, and stayed 518 for a
	 * second window that got `-orderOut:` before `-close`.
	 */
	test("a closed window is gone even though AppKit keeps its device number", () => {
		expect(windowLiveness({ visible: false, miniaturized: false, appHidden: false })).toBe(
			false,
		);
	});

	test("a minimised window and a hidden app are both still open", () => {
		expect(windowLiveness({ visible: false, miniaturized: true, appHidden: false })).toBe(true);
		expect(windowLiveness({ visible: false, miniaturized: false, appHidden: true })).toBe(true);
	});

	test("an ordinary on-screen window is open", () => {
		expect(windowLiveness({ visible: true, miniaturized: false, appHidden: false })).toBe(true);
	});
});

describe("pump timer", () => {
	test("starts, ticks, and stops without leaving a timer", async () => {
		const platform = new DarwinPlatform();
		platform.pump(16);
		expect(platform.pumping).toBe(true);
		expect(platform.ticks).toBeGreaterThan(0);

		await Bun.sleep(60);
		expect(platform.ticks).toBeGreaterThan(1);

		platform.stopPump();
		expect(platform.pumping).toBe(false);
		const stoppedAt = platform.ticks;

		// If the chain re-armed itself the counter would keep climbing.
		await Bun.sleep(60);
		expect(platform.ticks).toBe(stoppedAt);
	});

	test("refuses a non-positive interval", () => {
		const platform = new DarwinPlatform();
		expect(() => platform.pump(0)).toThrow();
		expect(() => platform.pump(-1)).toThrow();
	});
});
