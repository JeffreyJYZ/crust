/**
 * The `preview` plugin's own behaviour, driven through a fake surface: a shown file, a hidden panel,
 * and — the point of the namespace — a path outside `fs.scope` refused with the same code and sentence
 * `fs` uses instead of a preview that quietly did nothing.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CrustError } from "@/bridge/errors";
import { createFsScope } from "@/plugins/fs-scope";
import { createPreviewPlugin } from "@/plugins/preview";
import type { PreviewSurface } from "@/plugins/preview-surface";

const roots: string[] = [];
afterAll(async () => {
	for (const root of roots) await rm(root, { recursive: true, force: true });
});

/** A surface that answers like a panel: shown until hidden, with its own visible read. */
function fakeSurface(): PreviewSurface & { path?: string } {
	const state = { visible: false, path: undefined as string | undefined };
	return {
		name: "fake",
		get path() {
			return state.path;
		},
		show(request) {
			state.path = request.path;
			state.visible = true;
			return { ok: true, window: 7 };
		},
		hide() {
			state.visible = false;
			return { ok: true };
		},
		visible: () => state.visible,
	};
}

/** A real `fs.scope` over one directory, in the system temp dir so no app data is touched. */
async function scopeWith(): Promise<{
	inside: string;
	outside: string;
	scope: ReturnType<typeof createFsScope>;
}> {
	const root = await mkdtemp(join(tmpdir(), "crust-preview-scope-"));
	roots.push(root);
	const inside = join(root, "inside");
	const outside = join(root, "outside");
	await mkdir(inside, { recursive: true });
	await mkdir(outside, { recursive: true });
	await writeFile(join(inside, "report.txt"), "inside");
	await writeFile(join(outside, "secret.txt"), "outside");
	return { inside, outside, scope: createFsScope({ allow: [inside], root }) };
}

const OFFLINE = { check: async () => {} };

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
		expect(surface.path).toBe("/tmp/report.docx");
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
});

describe("the fs.scope boundary", () => {
	test("a file inside the scope is shown", async () => {
		const { inside, scope } = await scopeWith();
		const plugin = createPreviewPlugin({ surface: fakeSurface(), scope });
		expect(await plugin.commands.show({ path: join(inside, "report.txt") })).toMatchObject({
			ok: true,
		});
	});

	test("a file outside the scope is refused with fs's own code and sentence", async () => {
		const { outside, scope } = await scopeWith();
		const plugin = createPreviewPlugin({ surface: fakeSurface(), scope });
		const file = join(outside, "secret.txt");
		let thrown: CrustError | undefined;
		try {
			await plugin.commands.show({ path: file });
		} catch (error) {
			thrown = error as CrustError;
		}
		expect(thrown?.code).toBe("outside-scope");
		expect(thrown?.message).toContain(file);
	});

	test("a scope registered after construction still bounds the preview", async () => {
		// The registration runs before the `fs` plugin exists, so the boundary is read per call: a
		// scope captured at construction would be the unscoped fallback in every real app.
		const { inside, outside } = await scopeWith();
		const plugin = createPreviewPlugin({ surface: fakeSurface() });
		await expect(
			plugin.commands.show({ path: join(outside, "secret.txt") }),
		).rejects.toMatchObject({
			code: "outside-scope",
		});
		expect(await plugin.commands.show({ path: join(inside, "report.txt") })).toMatchObject({
			ok: true,
		});
	});

	test("a relative path never reaches the surface", async () => {
		const surface = fakeSurface();
		const plugin = createPreviewPlugin({ surface, scope: OFFLINE });
		await expect(plugin.commands.show({ path: "notes.txt" })).rejects.toMatchObject({
			code: "bad-request",
		});
		expect(surface.visible()).toBe(false);
	});
});

describe("a platform with no preview", () => {
	test("Linux answers the named refusal on both commands", async () => {
		const plugin = createPreviewPlugin({ scope: OFFLINE }, "linux");
		const shown = await plugin.commands.show({ path: "/tmp/a.docx" });
		expect(shown).toMatchObject({ ok: false, code: "not-implemented" });
		expect((shown as { message: string }).message).toContain(
			"Linux has no embedded system preview",
		);
		expect(await plugin.commands.hide()).toMatchObject({
			code: "not-implemented",
		});
	});
});
