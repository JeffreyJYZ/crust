/**
 * The build-time gate for embedded extensions and the runtime line that stays behind it. Before the
 * fix, `crust build` embedded every resolved file without checking its default export or name, and the
 * generated entry pushed bare `.default`s into `registry.register`, which threw before `startApp`.
 * These tests cover both lines: the validator a build calls to fail with file and reason, and the
 * registry refusing the same bad exports if a hand-written entry ever reaches it.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PluginDefinition } from "../plugins/define.ts";
import {
	extensionEntrySource,
	extensionErrorLines,
	validateExtensionEntries,
} from "./entry-source.ts";
import { extensionRegistry } from "./registry.ts";

const definePath = fileURLToPath(new URL("./define.ts", import.meta.url));

async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "crust-entry-validation-"));
	try {
		await run(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function extensionSource(name: string): string {
	return [
		`import { defineExtension } from ${JSON.stringify(definePath)};`,
		`export default defineExtension({ name: ${JSON.stringify(name)}, commands: { ping: () => "pong" } });`,
		"",
	].join("\n");
}

async function write(dir: string, name: string, source: string): Promise<string> {
	const path = join(dir, name);
	await writeFile(path, source, "utf8");
	return path;
}

/** Evaluate the generated entry so the runtime line can be exercised, not just read. */
async function loadEntry(dir: string, files: string[]): Promise<() => Promise<PluginDefinition[]>> {
	const source = extensionEntrySource({ files, projectDir: dir });
	const path = join(dir, `entry-${crypto.randomUUID()}.ts`);
	await writeFile(path, `${source}\nexport { extensionPlugins };\n`, "utf8");
	const module = (await import(`${path}?v=${crypto.randomUUID()}`)) as {
		extensionPlugins: () => Promise<PluginDefinition[]>;
	};
	return module.extensionPlugins;
}

describe("validateExtensionEntries — the build-time gate", () => {
	test("valid files pass with no errors, in the order given", async () => {
		await withDir(async (dir) => {
			const first = await write(dir, "a.ts", extensionSource("alpha"));
			const second = await write(dir, "b.ts", extensionSource("beta"));
			const result = await validateExtensionEntries([first, second]);
			expect(result.errors).toEqual([]);
			expect(result.files).toEqual([first, second]);
		});
	});

	test("a file with no default export is refused with its file and reason", async () => {
		await withDir(async (dir) => {
			const bad = await write(dir, "bad.ts", "export const nope = 1;\n");
			const result = await validateExtensionEntries([bad]);
			expect(result.files).toEqual([]);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]?.file).toBe(bad);
			expect(result.errors[0]?.reason).toMatch(/no default export/);
			// The exact text a build hands to fail(): it names the file and why it was refused.
			expect(extensionErrorLines(result.errors)[0]).toContain(bad);
			expect(extensionErrorLines(result.errors)[0]).toContain("no default export");
		});
	});

	test("two files claiming one name are both refused, each naming the other", async () => {
		await withDir(async (dir) => {
			const first = await write(dir, "a.ts", extensionSource("clock"));
			const second = await write(dir, "b.ts", extensionSource("clock"));
			const result = await validateExtensionEntries([first, second]);
			expect(result.files).toEqual([]);
			expect(result.errors.map((error) => error.file)).toEqual([first, second]);
			for (const error of result.errors)
				expect(error.reason).toContain('duplicate extension name "clock"');
			for (const line of extensionErrorLines(result.errors)) {
				expect(line).toContain("clock");
				expect(line).toContain("duplicate");
			}
		});
	});

	test("a plain plugin default is refused the way dev refuses it", async () => {
		await withDir(async (dir) => {
			const pluginPath = fileURLToPath(new URL("../plugins/define.ts", import.meta.url));
			const bad = await write(
				dir,
				"plain.ts",
				[
					`import { definePlugin } from ${JSON.stringify(pluginPath)};`,
					'export default definePlugin({ name: "clock", commands: { now: () => 1 } });',
					"",
				].join("\n"),
			);
			const result = await validateExtensionEntries([bad]);
			expect(result.files).toEqual([]);
			expect(result.errors[0]?.reason).toMatch(/not an extension/);
		});
	});
});

describe("the generated entry's runtime line stays a second line", () => {
	test("the registry still refuses a missing default if a bad entry reaches it", async () => {
		await withDir(async (dir) => {
			const bad = await write(dir, "bad.ts", "export const nope = 1;\n");
			const extensionPlugins = await loadEntry(dir, [bad]);
			const plugins = await extensionPlugins();
			expect(() => extensionRegistry().register(...plugins)).toThrow(
				"not a plugin definition",
			);
		});
	});

	test("the registry still refuses a duplicate name if a bad entry reaches it", async () => {
		await withDir(async (dir) => {
			const first = await write(dir, "a.ts", extensionSource("clock"));
			const second = await write(dir, "b.ts", extensionSource("clock"));
			const extensionPlugins = await loadEntry(dir, [first, second]);
			const plugins = await extensionPlugins();
			expect(plugins).toHaveLength(2);
			expect(() => extensionRegistry().register(...plugins)).toThrow("already registered");
		});
	});
});
