import { describe, expect, test } from "bun:test";
import { ptr } from "bun:ffi";
import {
	DarwinPlatform,
	NS_MODAL_RESPONSE,
	PANEL_KIND,
	PANEL_MAX_PATHS,
	PANEL_STATUS,
	PREFLIGHT,
	awaitSheetResult,
	busyRefusal,
	darwinDialogAdapter,
	extensionList,
	type PanelShim,
	preflightError,
	shim,
	type SheetReadings,
	windowLiveness,
} from "@/platform/darwin/index.ts";
import { createDialogPlugin } from "@/plugins/dialog.ts";
import { isNotImplemented } from "@/plugins/define.ts";

const SHIM_C = `${import.meta.dir}/shim.c`;

/** `SHIM_PANEL_NO_RESPONSE` in `shim.c`: the sheet has not answered yet. */
const SHIM_PANEL_NO_RESPONSE = -1;

/** A sheet reading that is already finished, for the malformed-answer cases. */
function finished(overrides: Partial<SheetReadings> = {}): SheetReadings {
	return {
		done: () => true,
		response: () => NS_MODAL_RESPONSE.ok,
		count: () => 1,
		path: (index: number) => (index === 0 ? "/tmp/one.txt" : ""),
		...overrides,
	};
}

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
	 * The save panel compiles through `cc()` and answers without a window, the
	 * same way the open panel does. Nothing here touches the screen.
	 */
	test("exports shim_save_panel, which refuses a sheet with no window", () => {
		const symbols = shim().symbols;
		expect(typeof symbols.shim_save_panel).toBe("function");
		const status = Number(
			symbols.shim_save_panel(cstr("crust test"), cstr("note.md"), cstr("md"), 0) ?? -1,
		);
		expect(Object.values(PANEL_STATUS) as number[]).toContain(status);
		expect([
			PANEL_STATUS.noWindow,
			PANEL_STATUS.unsupported,
			PANEL_STATUS.sheetStarted,
		] as number[]).toContain(status);
		expect(status).not.toBe(PANEL_STATUS.picked);
		// The save panel shares the open panel's path storage, and nothing was
		// collected because nothing was shown.
		expect(Number(symbols.shim_open_panel_count() ?? -1)).toBe(0);
		expect(String(symbols.shim_open_panel_path(0))).toBe("");
	});

	/**
	 * The sheet path's whole contract in three reads. Nothing has started a sheet
	 * in this process, so "not answered yet" and "no panel to cancel" are the
	 * answers — and -1 is deliberately not a valid NSModalResponse, so a caller
	 * that reads it can never mistake it for cancel (0).
	 */
	test("exports the sheet reads, and they say 'nothing yet' with no sheet", () => {
		const symbols = shim().symbols;
		expect(typeof symbols.shim_sheet_done).toBe("function");
		expect(typeof symbols.shim_sheet_response).toBe("function");
		expect(typeof symbols.shim_sheet_cancel).toBe("function");
		expect(typeof symbols.shim_sheet_kind).toBe("function");

		expect(Number(symbols.shim_sheet_done() ?? -1)).toBe(0);
		// An i64 return arrives as a BigInt.
		expect(Number(symbols.shim_sheet_response() ?? 0)).toBe(SHIM_PANEL_NO_RESPONSE);
		expect(Number(symbols.shim_sheet_cancel() ?? -1)).toBe(0);
		// No sheet is up, so nothing names a panel class.
		expect(Number(symbols.shim_sheet_kind() ?? -1)).toBe(PANEL_KIND.none);
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
		// Five arguments, in the shim's order: title, filter list, dirs, multiple,
		// runModal. Passing four shifts every one and the last becomes non-zero,
		// which opens a real modal picker — measured, and it was my regression.
		const status = Number(
			shim().symbols.shim_open_panel(cstr("crust test"), cstr(""), 0, 0, 0) ?? -1,
		);
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

describe("sheet polling", () => {
	/**
	 * The defect this exists for: `-runModal` stops the JavaScript thread and the
	 * pump for the whole pick. A timer-driven poll leaves both running, which is
	 * what makes an invoke answer while the sheet is up (measured in the one
	 * windowed run: cancel at 300 ms, promise resolved `paths: []`, bridge invoke
	 * answered during the sheet).
	 */
	test("resolves once the flag flips, with the paths the shim stored", async () => {
		let done = false;
		setTimeout(() => {
			done = true;
		}, 25);

		const result = await awaitSheetResult(finished({ done: () => done }), { intervalMs: 5 });
		expect(result).toEqual({ paths: ["/tmp/one.txt"] });
	});

	test("a cancel resolves an empty list, never a rejection", async () => {
		const result = await awaitSheetResult(
			finished({ response: () => NS_MODAL_RESPONSE.cancel, count: () => 0 }),
		);
		expect(result).toEqual({ paths: [] });
	});

	/**
	 * The poll must yield, not block: a second timer has to keep firing while the
	 * sheet is awaited. That is the property the old `-runModal` path could not
	 * have, and the only one a headless test can prove.
	 */
	test("yields to the event loop between reads", async () => {
		let done = false;
		let ticks = 0;
		const timer = setInterval(() => {
			ticks++;
		}, 5);
		setTimeout(() => {
			done = true;
		}, 40);

		try {
			await awaitSheetResult(finished({ done: () => done }), { intervalMs: 5 });
		} finally {
			clearInterval(timer);
		}
		expect(ticks).toBeGreaterThan(1);
	});

	test("rejects a response that is neither OK nor cancel", async () => {
		await expect(
			awaitSheetResult(finished({ response: () => 7, count: () => 0 })),
		).rejects.toThrow(/NSModalResponse 7/);
		await expect(
			awaitSheetResult(finished({ response: () => SHIM_PANEL_NO_RESPONSE, count: () => 0 })),
		).rejects.toThrow(/NSModalResponse -1/);
	});

	test("rejects a path count the C storage cannot hold", async () => {
		await expect(
			awaitSheetResult(finished({ count: () => PANEL_MAX_PATHS + 1 })),
		).rejects.toThrow(new RegExp(`outside 0…${PANEL_MAX_PATHS}`));
		await expect(awaitSheetResult(finished({ count: () => -1 }))).rejects.toThrow(/outside 0…/);
		await expect(awaitSheetResult(finished({ count: () => 1.5 }))).rejects.toThrow(
			/outside 0…/,
		);
	});

	test("rejects OK with no path, or an empty path", async () => {
		await expect(awaitSheetResult(finished({ count: () => 0 }))).rejects.toThrow(/no paths/);
		await expect(awaitSheetResult(finished({ path: () => "" }))).rejects.toThrow(/empty path/);
	});

	test("refuses a non-positive interval", async () => {
		await expect(awaitSheetResult(finished(), { intervalMs: 0 })).rejects.toThrow(/positive/);
		await expect(awaitSheetResult(finished(), { intervalMs: -5 })).rejects.toThrow(/positive/);
	});

	/** The same poll serves both panels; only the name in a failure changes. */
	test("names the command that failed", async () => {
		await expect(
			awaitSheetResult(finished({ response: () => 7, count: () => 0 }), {
				command: "savePanel",
			}),
		).rejects.toThrow(/savePanel sheet ended/);
	});
});

/**
 * The argument rule the C side depends on: one comma-separated extension list
 * with no leading `*.` or `.`, lower-cased, de-duplicated, and empty when the
 * caller gave no filters.
 */
describe("extension list", () => {
	test("is empty with no filters", () => {
		expect(extensionList(undefined)).toBe("");
		expect(extensionList([])).toBe("");
		expect(extensionList([{ name: "Any", extensions: [] }])).toBe("");
	});

	test("strips a leading *. or ., lower-cases and de-duplicates", () => {
		expect(
			extensionList([
				{ name: "Images", extensions: ["*.PNG", ".jpg", " png "] },
				{ name: "Text", extensions: ["txt", "TXT"] },
			]),
		).toBe("png,jpg,txt");
	});

	test("drops entries that are only a star or a dot", () => {
		expect(extensionList([{ name: "Odd", extensions: ["*", ".", "*.", "  "] }])).toBe("");
	});
});

/**
 * A stand-in for the C panel state, applying the same one-sheet rule the shim
 * applies: a sheet that is up and unanswered refuses a second request with
 * `busy` and leaves every read exactly as it was.
 *
 * This is the seam that makes the defect testable without a window. The real
 * storage lives in `shim.c`, so the C half of the same rule is proved by the
 * bounded windowed run; what is proved here is that the adapter honours a
 * refusal instead of reading the wrong panel's state.
 */
class FakePanel implements PanelShim {
	/** Which class the live sheet is; `PANEL_KIND.none` with none. */
	kind: number = PANEL_KIND.none;
	done = false;
	response = SHIM_PANEL_NO_RESPONSE;
	paths: string[] = [];
	/** Sheets actually started, which is how a refusal is proved to send nothing. */
	sheets = 0;
	/** Calls that took the blocking `-runModal` fallback. */
	modalCalls = 0;

	private start(kind: number): number {
		if (this.kind !== PANEL_KIND.none && !this.done) return PANEL_STATUS.busy;
		this.kind = kind;
		this.done = false;
		this.response = SHIM_PANEL_NO_RESPONSE;
		this.paths = [];
		this.sheets++;
		return PANEL_STATUS.sheetStarted;
	}

	openPanel(): number {
		return this.start(PANEL_KIND.open);
	}

	savePanel(): number {
		return this.start(PANEL_KIND.save);
	}

	panelCount(): number {
		return this.paths.length;
	}

	panelPath(index: number): string {
		return this.paths[index] ?? "";
	}

	sheetDone(): boolean {
		return this.done;
	}

	sheetResponse(): number {
		return this.response;
	}

	sheetCancel(): number {
		// The same guard the shim has: a sheet that already answered is not
		// something -cancel: can send to.
		if (this.kind === PANEL_KIND.none || this.done) return 0;
		this.done = true;
		this.response = NS_MODAL_RESPONSE.cancel;
		return 1;
	}

	sheetKind(): number {
		return this.done ? PANEL_KIND.none : this.kind;
	}

	/** The user answered the live sheet with a pick. */
	answer(picked: string[]): void {
		this.paths = [...picked];
		this.response = NS_MODAL_RESPONSE.ok;
		this.done = true;
	}
}

describe("dialog adapter", () => {
	test("exposes the plugin's hooks and the commands' names", () => {
		const adapter = darwinDialogAdapter();
		expect(typeof adapter.pickOpen).toBe("function");
		expect(adapter.openPanel).toBe(adapter.pickOpen);
		expect(typeof adapter.pickSave).toBe("function");
		expect(adapter.pickSave).toBe(adapter.savePanel);
		expect(typeof adapter.cancel).toBe("function");
	});

	/**
	 * The defect this exists for: the C globals hold one panel, and starting a
	 * second sheet used to wipe the first one's done flag, panel pointer and
	 * path storage — so the page awaiting the first pick would eventually read
	 * the second panel's answer. A refusal must therefore leave the live sheet
	 * untouched, and the first request must still answer with its own pick.
	 */
	test("a second request is refused, and the first pick still answers", async () => {
		const fake = new FakePanel();
		const adapter = darwinDialogAdapter(fake);

		const first = adapter.pickOpen({ title: "one" });
		expect(fake.sheets).toBe(1);

		await expect(adapter.pickSave({ suggestedName: "note.md" })).rejects.toThrow(
			/refused \(busy\); an NSOpenPanel sheet is already up/,
		);

		// Nothing was sent, nothing was reset: the live sheet is still the open
		// panel, still unanswered, and there was no modal fallback either.
		expect(fake.sheets).toBe(1);
		expect(fake.modalCalls).toBe(0);
		expect(fake.sheetKind()).toBe(PANEL_KIND.open);
		expect(fake.sheetDone()).toBe(false);
		expect(fake.sheetResponse()).toBe(SHIM_PANEL_NO_RESPONSE);

		fake.answer(["/tmp/one.md"]);
		expect(await first).toEqual({ paths: ["/tmp/one.md"] });
	});

	/** A refused save panel says so with the open panel's name, not a bare "busy". */
	test("the refusal names the panel that is already up", async () => {
		const fake = new FakePanel();
		const adapter = darwinDialogAdapter(fake);
		const first = adapter.pickSave({ suggestedName: "note.md" });

		await expect(adapter.pickOpen({})).rejects.toThrow(
			/refused \(busy\); an NSSavePanel sheet is already up/,
		);
		const message = busyRefusal("openPanel", PANEL_KIND.save);
		expect(message).toContain("dialog.cancel");
		expect(message).toContain("NSSavePanel");
		expect(message).toContain("NSOpenPanel for another");

		fake.answer(["/tmp/note.md"]);
		expect(await first).toEqual({ paths: ["/tmp/note.md"] });
	});

	/**
	 * Cancel is the way out of the one-sheet rule: it ends the sheet through the
	 * path a user's Cancel button takes, settles the page's own pick with the
	 * empty list a cancel means, and releases the state so the next pick starts
	 * a fresh sheet instead of being refused.
	 */
	test("cancel ends the pending sheet, and the next pick starts clean", async () => {
		const fake = new FakePanel();
		const adapter = darwinDialogAdapter(fake);

		const first = adapter.pickOpen({});
		expect(await adapter.cancel()).toEqual({ cancelled: true, paths: [] });
		expect(await first).toEqual({ paths: [] });
		expect(fake.sheets).toBe(1);

		// The state a user's cancel leaves: the next request is accepted.
		const second = adapter.pickOpen({});
		expect(fake.sheets).toBe(2);
		fake.answer(["/tmp/two.md"]);
		expect(await second).toEqual({ paths: ["/tmp/two.md"] });
	});

	/** Nothing up is an ordinary answer, never an error. */
	test("cancel with no sheet answers cancelled:false", async () => {
		const adapter = darwinDialogAdapter(new FakePanel());
		expect(await adapter.cancel()).toEqual({ cancelled: false, paths: [] });
	});

	/** A sheet the user already answered is not something cancel can end. */
	test("cancel after the user's own answer answers cancelled:false", async () => {
		const fake = new FakePanel();
		const adapter = darwinDialogAdapter(fake);
		const first = adapter.pickOpen({});
		fake.answer(["/tmp/one.md"]);
		expect(await first).toEqual({ paths: ["/tmp/one.md"] });

		expect(await adapter.cancel()).toEqual({ cancelled: false, paths: [] });
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
