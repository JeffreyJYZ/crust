/**
 * The `preview` plugin's own behaviour, driven through a fake surface: a shown file, a hidden panel,
 * and the two distinct refusals — a platform with no panel versus a panel that refused this call.
 */
import { afterAll, describe, expect, test } from "bun:test";

import { canonical } from "@/plugins/fs-scope-path";
import { createPreviewPlugin } from "@/plugins/preview";
import { cleanup, fakeSurface, OFFLINE } from "./preview-fixture.ts";

afterAll(cleanup);

describe("preview.show and preview.hide", () => {
	test("show answers visible true and the file it was given", async () => {
		const surface = fakeSurface();
		const plugin = createPreviewPlugin({ surface, scope: OFFLINE });
		const shown = await plugin.commands.show({ path: "/tmp/report.docx" });
		expect(shown).toMatchObject({
			ok: true,
			path: "/tmp/report.docx",
			visible: true,
			window: 7,
		});
		// The surface opens the canonical path the scope approved, not the caller's spelling:
		// a raw symlink could be repointed between the check and QuickLook reading the URL.
		expect(surface.path).toBe(await canonical("/tmp/report.docx"));
	});

	test("the config's size is the default, and a page's own pair wins", async () => {
		const plugin = createPreviewPlugin({
			surface: fakeSurface(),
			scope: OFFLINE,
			width: 640,
			height: 480,
		});
		expect(await plugin.commands.show({ path: "/tmp/a.docx" })).toMatchObject({
			width: 640,
			height: 480,
		});
		expect(
			await plugin.commands.show({
				path: "/tmp/a.docx",
				width: 100,
				height: 50,
			}),
		).toMatchObject({
			width: 100,
			height: 50,
		});
	});

	test("hide answers the panel's own visible read", async () => {
		const plugin = createPreviewPlugin({
			surface: fakeSurface(),
			scope: OFFLINE,
		});
		await plugin.commands.show({ path: "/tmp/a.docx" });
		expect(await plugin.commands.hide()).toEqual({
			ok: true,
			visible: false,
		});
	});

	test("a surface refusal becomes a named not-implemented", async () => {
		const surface = fakeSurface();
		surface.show = () => ({
			ok: false,
			message: "no handler",
			requires: "IPreviewHandler",
		});
		const plugin = createPreviewPlugin({ surface, scope: OFFLINE });
		expect(await plugin.commands.show({ path: "/tmp/a.docx" })).toEqual({
			ok: false,
			code: "not-implemented",
			message: "no handler",
			requires: "IPreviewHandler",
		});
	});

	test("a panel that exists but refused the call answers preview-failed with its reason", async () => {
		const surface = fakeSurface();
		surface.show = () => ({
			ok: false,
			code: "preview-failed",
			message: "QLPreviewPanel is missing orderOut:",
		});
		const plugin = createPreviewPlugin({ surface, scope: OFFLINE });
		expect(await plugin.commands.show({ path: "/tmp/a.docx" })).toEqual({
			ok: false,
			code: "preview-failed",
			message: "QLPreviewPanel is missing orderOut:",
		});
	});

	test("a refused hide with a live panel answers preview-failed, not not-implemented", async () => {
		const surface = fakeSurface();
		surface.hide = () => ({
			ok: false,
			code: "preview-failed",
			message: "orderOut: was refused",
		});
		const plugin = createPreviewPlugin({ surface, scope: OFFLINE });
		expect(await plugin.commands.hide()).toEqual({
			ok: false,
			code: "preview-failed",
			message: "orderOut: was refused",
		});
	});
});
