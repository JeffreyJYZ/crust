/**
 * The preview adapter and its teardown, driven with a fake so nothing reaches AppKit.
 * `QLPreviewPanel` is the system's own window: showing it takes keyboard focus from whatever the
 * human is doing, so this file never calls the real `show`. What it proves is the seam that used to
 * be the defect in every other panel — the adapter's own refusals, and the owner comparison a second
 * window's close depends on. The compiled unit is `preview-unit.test.ts`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	darwinPreviewAdapter,
	PREVIEW_STATUS,
	type PreviewNative,
	previewOwnerCheck,
	previewWindowClosed,
	setPreviewOwnerResolver,
} from "./preview.ts";

/** The C half, faked so a refusal is proved to send nothing to AppKit. */
export class FakePreview implements PreviewNative {
	calls: string[] = [];
	visibleFlag = false;
	ownerValue = 0;
	reasonText = "faked";
	status: number = PREVIEW_STATUS.ok;
	availableValue: number = 1;
	stored: number = 1;

	available(): number {
		this.calls.push("available");
		return this.availableValue;
	}
	setPaths(text: string): number {
		this.calls.push(`setPaths:${text}`);
		return this.stored;
	}
	owner(): number {
		return this.ownerValue;
	}
	show(owner: number, width: number, height: number): number {
		this.calls.push(`show:${owner}:${width}:${height}`);
		if (this.status === PREVIEW_STATUS.ok) {
			this.ownerValue = owner;
			this.visibleFlag = true;
		}
		return this.status;
	}
	hide(): number {
		this.calls.push("hide");
		this.ownerValue = 0;
		this.visibleFlag = false;
		return PREVIEW_STATUS.ok;
	}
	visible(): boolean {
		return this.visibleFlag;
	}
	key(): boolean {
		return this.visibleFlag;
	}
	windowNumber(): number {
		return this.visibleFlag ? 77 : 0;
	}
	ownerLive(): number {
		this.calls.push("ownerLive");
		return 1;
	}
	reason(): string {
		return this.reasonText;
	}
}

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A real file on disk, since `show` refuses one that does not exist. */
export function realFile(name: string): string {
	const dir = mkdtempSync(join(tmpdir(), "crust-preview-"));
	dirs.push(dir);
	const path = join(dir, name);
	writeFileSync(path, "crust preview fixture\n");
	return path;
}

describe("the preview adapter", () => {
	test("a relative path is refused before any AppKit send", () => {
		const native = new FakePreview();
		const outcome = darwinPreviewAdapter(native).show({ path: "notes.docx" });
		expect(outcome.ok).toBe(false);
		expect(outcome.reason).toMatch(/absolute path/);
		expect(native.calls).toEqual([]);
	});

	test("an absolute path with no file is refused by name", () => {
		const native = new FakePreview();
		const outcome = darwinPreviewAdapter(native).show({ path: "/nonexistent/crust/x.docx" });
		expect(outcome.ok).toBe(false);
		expect(outcome.status).toBe(PREVIEW_STATUS.noPaths);
		expect(outcome.reason).toContain("/nonexistent/crust/x.docx");
		expect(native.calls).toEqual([]);
	});

	test("one real file reaches C with the window it floats over", () => {
		const native = new FakePreview();
		const path = realFile("report.txt");
		const outcome = darwinPreviewAdapter(native).show({
			path,
			window: 4242,
			width: 600,
			height: 400,
		});
		expect(outcome).toEqual({ ok: true, status: PREVIEW_STATUS.ok, reason: "faked" });
		expect(native.calls).toContain(`setPaths:${path}`);
		expect(native.calls).toContain("show:4242:600:400");
	});

	test("a panel that could not be ordered front is a refusal, not a success", () => {
		const native = new FakePreview();
		native.status = PREVIEW_STATUS.unavailable;
		native.reasonText = "QLPreviewPanel is not reachable (QuickLookUI did not load)";
		const outcome = darwinPreviewAdapter(native).show({ path: realFile("x.txt") });
		expect(outcome.ok).toBe(false);
		expect(outcome.status).toBe(PREVIEW_STATUS.unavailable);
		expect(outcome.reason).toMatch(/QuickLookUI did not load/);
	});

	test("available() reports the C gate rather than optimism", () => {
		const native = new FakePreview();
		expect(darwinPreviewAdapter(native).available()).toEqual({
			available: true,
			reason: "QLPreviewPanel is reachable",
		});
		native.availableValue = 0;
		native.reasonText = "no QuickLookUI";
		expect(darwinPreviewAdapter(native).available()).toEqual({
			available: false,
			reason: "no QuickLookUI",
		});
	});

	test("hide is the C send's own answer", () => {
		const native = new FakePreview();
		const adapter = darwinPreviewAdapter(native);
		adapter.show({ path: realFile("y.txt") });
		expect(adapter.hide().ok).toBe(true);
		expect(native.calls.at(-1)).toBe("hide");
		expect(adapter.visible()).toBe(false);
		expect(adapter.windowNumber()).toBe(0);
	});
});

describe("the panel's owner", () => {
	test("the registered resolver names the window a panel floats over", () => {
		setPreviewOwnerResolver((label) => (label === "side" ? 909 : 4242));
		try {
			const adapter = darwinPreviewAdapter(new FakePreview());
			expect(adapter.owner("side")).toBe(909);
			expect(adapter.owner()).toBe(4242);
		} finally {
			setPreviewOwnerResolver(() => 0);
		}
	});
});

describe("a window closes under the panel", () => {
	test("the preview is ordered out only when its own window closes", () => {
		const native = new FakePreview();
		darwinPreviewAdapter(native).show({ path: realFile("z.txt"), window: 7 });
		previewWindowClosed(8, native);
		expect(native.calls).not.toContain("hide");
		previewWindowClosed(7, native);
		expect(native.calls).toContain("hide");
	});

	test("the pump's poll reaches the C owner check once a panel exists", () => {
		const native = new FakePreview();
		darwinPreviewAdapter(native).show({ path: realFile("w.txt"), window: 9 });
		previewOwnerCheck(native);
		expect(native.calls).toContain("ownerLive");
	});
});
