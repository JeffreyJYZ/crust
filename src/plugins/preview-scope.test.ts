/**
 * The `fs.scope` boundary of `crust:preview`: an in-scope file shows, a symlink is opened at the
 * canonical path the scope approved, and a file outside the boundary is refused with fs's own code.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { symlink } from "node:fs/promises";
import { join } from "node:path";

import type { CrustError } from "@/bridge/errors";
import { canonical } from "@/plugins/fs-scope-path";
import { createPreviewPlugin } from "@/plugins/preview";
import { cleanup, fakeSurface, OFFLINE, scopeWith } from "./preview-fixture.ts";

afterAll(cleanup);

describe("the fs.scope boundary", () => {
	test("a file inside the scope is shown", async () => {
		const { inside, scope } = await scopeWith();
		const plugin = createPreviewPlugin({ surface: fakeSurface(), scope });
		expect(await plugin.commands.show({ path: join(inside, "report.txt") })).toMatchObject({
			ok: true,
		});
	});

	test("a symlink is opened at the path the scope approved, not the caller's spelling", async () => {
		const { inside, scope } = await scopeWith();
		const surface = fakeSurface();
		const plugin = createPreviewPlugin({ surface, scope });
		const link = join(inside, "link.txt");
		await symlink(join(inside, "report.txt"), link);
		expect(await plugin.commands.show({ path: link })).toMatchObject({ ok: true });
		expect(surface.path).toBe(await canonical(link));
		expect(surface.path).toBe(await canonical(join(inside, "report.txt")));
		expect(surface.path).not.toBe(link);
	});

	test("the calling window's label reaches the surface as the panel owner", async () => {
		const surface = fakeSurface();
		const plugin = createPreviewPlugin({ surface, scope: OFFLINE });
		await plugin.commands.show({ path: "/tmp/a.docx" }, { window: "side", emit: () => {} });
		expect(surface.window).toBe("side");
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
});
