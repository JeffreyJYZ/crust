/**
 * The two platform halves and the honest refusals: a panel is shown over a fake native half, a
 * QuickLook refusal reaches the caller in QuickLook's own words, and Linux says exactly what it lacks.
 */
import { describe, expect, test } from "bun:test";
import {
	darwinSurface,
	linuxRefusal,
	type PreviewSurface,
	resolvePreviewSurface,
	windowsRefusal,
} from "@/plugins/preview-surface";

/** A native half that records calls, so the adapter contract is what is measured. */
function fakeNative(state: { available?: boolean; reason?: string; shown?: boolean } = {}) {
	const calls = { show: 0, hide: 0 };
	const native = {
		available: () => ({
			available: state.available ?? true,
			reason: state.reason ?? "QLPreviewPanel is reachable",
		}),
		show: () => {
			calls.show++;
			state.shown = true;
			return { ok: true, reason: "shown" };
		},
		hide: () => {
			calls.hide++;
			state.shown = false;
			return { ok: true, reason: "hidden" };
		},
		owner: (_label?: string) => 4242,
		visible: () => state.shown === true,
		windowNumber: () => 4242,
	};
	return { native, calls };
}

describe("the macOS surface", () => {
	test("show answers the panel's window and its own visible read", () => {
		const state: { shown?: boolean } = {};
		const { native } = fakeNative(state);
		const surface: PreviewSurface = darwinSurface(native);
		const answer = surface.show({
			path: "/tmp/a.docx",
			width: 0,
			height: 0,
		});
		expect(answer).toEqual({ ok: true, window: 4242 });
		expect(surface.visible()).toBe(true);
		expect(surface.hide()).toEqual({ ok: true });
		expect(surface.visible()).toBe(false);
	});

	test("an ownerless panel answers preview-failed instead of outliving every window", () => {
		const { native } = fakeNative();
		native.owner = () => 0;
		expect(darwinSurface(native).show({ path: "/tmp/a.docx", width: 0, height: 0 })).toEqual({
			ok: false,
			code: "preview-failed",
			message: "preview.show needs an open owner window to float over",
		});
	});

	test("the caller's label chooses the native owner", () => {
		const { native } = fakeNative();
		const labels: (string | undefined)[] = [];
		native.owner = (label) => {
			labels.push(label);
			return label === "side" ? 99 : 0;
		};
		expect(
			darwinSurface(native).show({
				path: "/tmp/a.docx",
				width: 0,
				height: 0,
				window: "side",
			}),
		).toEqual({ ok: true, window: 4242 });
		expect(labels).toEqual(["side"]);
	});

	test("a missing QLPreviewPanel is refused in the framework's own sentence", () => {
		const { native } = fakeNative({
			available: false,
			reason: "QuickLookUI did not load",
		});
		const surface = darwinSurface(native);
		expect(surface.show({ path: "/tmp/a.docx", width: 0, height: 0 })).toEqual({
			ok: false,
			message: "QuickLookUI did not load",
			requires: "QLPreviewPanel",
		});
	});

	test("a refused show is a typed preview-failed carrying the native reason", () => {
		const { native } = fakeNative();
		native.show = () => ({
			ok: false,
			reason: "QLPreviewPanel is missing orderOut:",
		});
		const answer = darwinSurface(native).show({
			path: "/tmp/a.docx",
			width: 0,
			height: 0,
		});
		expect(answer).toEqual({
			ok: false,
			code: "preview-failed",
			message: "QLPreviewPanel is missing orderOut:",
		});
	});

	test("a refused hide is a typed preview-failed, not a missing panel", () => {
		const { native } = fakeNative();
		native.hide = () => ({ ok: false, reason: "orderOut: was refused" });
		expect(darwinSurface(native).hide()).toEqual({
			ok: false,
			code: "preview-failed",
			message: "orderOut: was refused",
		});
	});
});

describe("platform resolution", () => {
	test("Linux says exactly that there is no embedded system preview", async () => {
		const refusal = linuxRefusal();
		expect(refusal.code).toBe("not-implemented");
		expect(refusal.message).toContain("Linux has no embedded system preview");
		expect(refusal.message).toContain("opener.openPath");
		expect(await resolvePreviewSurface("linux")).toMatchObject({
			code: "not-implemented",
		});
	});

	test("Windows names the window handle the host would need", async () => {
		const refusal = windowsRefusal();
		expect(refusal.requires).toBe("the app window's HWND");
		expect(await resolvePreviewSurface("win32")).toMatchObject({
			code: "not-implemented",
		});
	});

	test("an unknown platform names itself", async () => {
		const resolved = await resolvePreviewSurface("freebsd");
		expect(resolved).toMatchObject({ code: "not-implemented" });
		expect((resolved as { message: string }).message).toContain("freebsd");
	});
});
