import { describe, expect, test } from "bun:test";
import {
	awaitSheetResult,
	extensionList,
	NS_MODAL_RESPONSE,
	PANEL_MAX_PATHS,
	type SheetReadings,
} from "./index.ts";

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
