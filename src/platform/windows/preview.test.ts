/**
 * The preview host's answers, driven through a fake shim: what a Mac can prove about a Windows surface.
 *
 * What it does not prove: that Windows registers a handler for any extension, that `CoCreateInstance`
 * succeeds, or that a preview renders. Those need the runner, and `scripts/windows/preview.ts` is
 * where they are asserted.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_WINDOWS_SHIM } from "./active-shim.ts";
import {
	isFile,
	PREVIEW_STATUS,
	previewDetail,
	windowsPreviewHost,
	type WindowsPreviewShim,
} from "./preview.ts";

const DIR = mkdtempSync(join(tmpdir(), "crust-preview-"));
const FILE = join(DIR, "notes.txt");
writeFileSync(FILE, "a line of text\n");

interface ShowCall {
	path: string;
	length: number;
	parent: number;
	rect: number[];
}

/** The six members the module calls, and a log of what reached them. */
function fakeShim(options: { status?: number; hwnd?: number; step?: number; hr?: number } = {}) {
	const calls: ShowCall[] = [];
	const sizes: number[][] = [];
	let hides = 0;
	const shim: WindowsPreviewShim = {
		shim_preview_show: (bytes, length, parent, x, y, width, height) => {
			calls.push({
				path: Buffer.from(bytes.subarray(0, length)).toString("utf8"),
				length,
				parent,
				rect: [x, y, width, height],
			});
			return options.status ?? PREVIEW_STATUS.shown;
		},
		shim_preview_hide: () => {
			hides++;
			return 1;
		},
		shim_preview_size: (x, y, width, height) => {
			sizes.push([x, y, width, height]);
			return 1;
		},
		shim_preview_hwnd: () => options.hwnd ?? 0,
		shim_preview_step: () => options.step ?? 0,
		shim_preview_hresult: () => options.hr ?? 0,
	};
	return { shim, calls, sizes, hides: () => hides };
}

const RECT = { x: 8, y: 8, width: 320, height: 200 };

describe("show", () => {
	test("a shown preview answers its host window and hands over file, parent and rect", () => {
		const { shim, calls } = fakeShim({ hwnd: 77 });
		const host = windowsPreviewHost(() => shim);
		expect(host.show({ path: FILE, parent: 9, ...RECT })).toEqual({ ok: true, hwnd: 77 });
		expect(calls).toEqual([
			{ path: FILE, length: Buffer.byteLength(FILE), parent: 9, rect: [8, 8, 320, 200] },
		]);
		expect(host.hwnd()).toBe(77);
	});

	/**
	 * `no-handler` is the ordinary answer for a file type Windows has no preview for, and it is worded
	 * with the extension because that is the fact the user can act on.
	 */
	test("no registered handler is its own answer, never a failure", () => {
		const { shim } = fakeShim({ status: PREVIEW_STATUS.noHandler });
		const outcome = windowsPreviewHost(() => shim).show({ path: FILE, parent: 9, ...RECT });
		expect(outcome).toEqual({
			ok: false,
			reason: "no-handler",
			detail: "no preview handler is registered for .txt files",
		});
	});

	test("a refused COM call carries the step and the HRESULT", () => {
		// E_NOINTERFACE from the initialiser step: the shape a handler that takes none of the three
		// initialisers produces, and the one a user is most likely to meet.
		const { shim } = fakeShim({ status: PREVIEW_STATUS.failed, step: 3, hr: -2147467262 });
		const outcome = windowsPreviewHost(() => shim).show({ path: FILE, parent: 9, ...RECT });
		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.reason).toBe("preview-failed");
		expect(outcome.detail).toBe("the handler refused this file (0x80004002)");
	});

	test("a missing entry point names the modules, not a handler", () => {
		const { shim } = fakeShim({ status: PREVIEW_STATUS.failed, step: 8, hr: 0 });
		const outcome = windowsPreviewHost(() => shim).show({ path: FILE, parent: 9, ...RECT });
		if (outcome.ok) throw new Error("expected a refusal");
		expect(outcome.detail).toContain("shlwapi, ole32 or shell32");
	});

	/** A property that answered "shown" with no window would make a page believe a preview exists. */
	test("shown with no host window is refused rather than believed", () => {
		const { shim } = fakeShim({ hwnd: 0 });
		const outcome = windowsPreviewHost(() => shim).show({ path: FILE, parent: 9, ...RECT });
		expect(outcome).toEqual({
			ok: false,
			reason: "preview-failed",
			detail: "the shim reported a preview with no host window",
		});
	});

	test("an unknown status is a failure, not a success", () => {
		const { shim } = fakeShim({ status: 9, hwnd: 12 });
		const outcome = windowsPreviewHost(() => shim).show({ path: FILE, parent: 9, ...RECT });
		if (outcome.ok) throw new Error("expected a refusal");
		expect(outcome.reason).toBe("preview-failed");
	});
});

describe("the one check this side owns", () => {
	test("a path that is not a file is refused before any COM call", () => {
		const { shim, calls } = fakeShim();
		const outcome = windowsPreviewHost(() => shim).show({
			path: join(DIR, "absent.txt"),
			parent: 9,
			...RECT,
		});
		expect(outcome).toEqual({
			ok: false,
			reason: "not-a-file",
			detail: `no file at ${join(DIR, "absent.txt")}`,
		});
		expect(calls).toEqual([]);
	});

	test("a directory exists and is still not a file", () => {
		const folder = join(DIR, "folder");
		mkdirSync(folder, { recursive: true });
		expect(isFile(folder)).toBe(false);
		expect(isFile(FILE)).toBe(true);
		const outcome = windowsPreviewHost(() => undefined).show({
			path: folder,
			parent: 9,
			...RECT,
		});
		if (outcome.ok) throw new Error("expected a refusal");
		expect(outcome.reason).toBe("not-a-file");
	});
});

describe("size and hide", () => {
	test("a resize reaches the shim with its rect", () => {
		const { shim, sizes } = fakeShim({ hwnd: 4 });
		const host = windowsPreviewHost(() => shim);
		expect(host.size(RECT)).toBe(true);
		expect(sizes).toEqual([[8, 8, 320, 200]]);
	});

	test("hide is idempotent and answers true", () => {
		const { shim, hides } = fakeShim();
		const host = windowsPreviewHost(() => shim);
		expect(host.hide()).toBe(true);
		expect(host.hide()).toBe(true);
		expect(hides()).toBe(2);
	});
});

describe("the platform has to exist", () => {
	test("a process with no Windows platform throws rather than invent a preview", () => {
		expect(() =>
			windowsPreviewHost(() => undefined).show({ path: FILE, parent: 9, ...RECT }),
		).toThrow(NO_WINDOWS_SHIM);
	});

	test("an unknown step index is still a sentence", () => {
		const { shim } = fakeShim({ status: PREVIEW_STATUS.failed, step: 42, hr: 0 });
		expect(previewDetail(shim)).toBe("the preview stopped at step-42");
	});
});
