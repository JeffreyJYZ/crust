/**
 * The runtime hands its configured `fs.scope` to `i18n`, so a page cannot use the language loader
 * as an unscoped read primitive. Both platform arms register one `i18n` plugin.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginDefinition } from "@/plugins/define";
import { nativePlugins } from "@/runtime-plugins.ts";

type Plugin = PluginDefinition<string, Record<string, (args?: unknown) => Promise<unknown>>>;

async function call(plugin: Plugin, name: string, args?: unknown): Promise<unknown> {
	const handler = plugin.commands[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return await handler(args);
}

describe("i18n inherits the configured fs scope", () => {
	for (const os of ["win32", "linux"]) {
		test(`${os}: outside directory refused, inside directory loads`, async () => {
			const base = await realpath(await mkdtemp(join(tmpdir(), "crust-runtime-i18n-")));
			try {
				const allowed = join(base, "allowed");
				const outside = join(base, "outside");
				await mkdir(allowed);
				await mkdir(outside);
				await writeFile(join(allowed, "en.json"), '{"title":"INSIDE"}', "utf8");
				await writeFile(join(outside, "secret.json"), '{"token":"OUTSIDE"}', "utf8");
				const plugins = await nativePlugins(
					[],
					undefined,
					{ fs: { scope: [allowed] }, app: `land.jyz.i18n-scope.${os}-${Date.now()}` },
					os,
				);
				const matches = plugins.filter((plugin) => plugin.name === "i18n");
				expect(matches.length).toBe(1);
				const plugin = matches[0] as Plugin;
				await expect(call(plugin, "load", { directory: outside })).rejects.toMatchObject({
					code: "outside-scope",
				});
				expect(await call(plugin, "load", { directory: allowed })).toMatchObject({
					ok: true,
					available: ["en"],
				});
			} finally {
				await rm(base, { recursive: true, force: true });
			}
		});
	}
});
