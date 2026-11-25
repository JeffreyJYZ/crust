/**
 * `i18n.load` is a page-callable filesystem read. With an injected scope it must refuse a directory
 * outside that scope and answer only from a locale directory the host allowed.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFsScope } from "@/plugins/fs-scope";
import { createI18nPlugin } from "@/plugins/i18n";

type Plugin = ReturnType<typeof createI18nPlugin>;

async function call<T>(plugin: Plugin, name: string, args?: unknown): Promise<T> {
	const handler = (plugin.commands as Record<string, (input?: unknown) => unknown>)[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return (await handler(args)) as T;
}

describe("i18n.load stays inside the fs scope", () => {
	test("an outside directory is refused and contributes no messages", async () => {
		const base = await realpath(await mkdtemp(join(tmpdir(), "crust-i18n-scope-")));
		try {
			const allowed = join(base, "allowed");
			const outside = join(base, "outside");
			await mkdir(allowed);
			await mkdir(outside);
			await writeFile(join(allowed, "en.json"), '{"title":"INSIDE"}', "utf8");
			await writeFile(join(outside, "secret.json"), '{"token":"OUTSIDE"}', "utf8");
			const plugin = createI18nPlugin({
				scope: createFsScope({ allow: [allowed], root: base }),
			});
			await expect(call(plugin, "load", { directory: outside })).rejects.toMatchObject({
				code: "outside-scope",
			});
			// The read must not have happened: no locale was merged into the catalogue.
			expect(await call(plugin, "messages", { locale: "secret" })).toMatchObject({
				ok: false,
			});
		} finally {
			await rm(base, { recursive: true, force: true });
		}
	});

	test("a locale directory inside the scope still loads", async () => {
		const base = await realpath(await mkdtemp(join(tmpdir(), "crust-i18n-scope-")));
		try {
			const allowed = join(base, "allowed");
			await mkdir(allowed);
			await writeFile(join(allowed, "en.json"), '{"title":"INSIDE"}', "utf8");
			const plugin = createI18nPlugin({
				scope: createFsScope({ allow: [allowed], root: base }),
			});
			expect(await call(plugin, "load", { directory: allowed })).toMatchObject({
				ok: true,
				available: ["en"],
			});
			expect(await call(plugin, "messages", { locale: "en" })).toMatchObject({
				messages: { title: "INSIDE" },
			});
		} finally {
			await rm(base, { recursive: true, force: true });
		}
	});
});
