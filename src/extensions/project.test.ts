/**
 * `crust dev` and `crust build` must agree about a project's extensions: the same files, and the
 * same sentence when one of them cannot be loaded. The build path is the expression
 * `src/cli/build.ts` runs, copied here verbatim so a change to either side fails this file.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_EXTENSIONS_DIR, resolveExtensionFiles } from "./load.ts";
import { extensionErrorLines, loadProjectExtensions, missingExtensionEntry } from "./project.ts";

const definePath = fileURLToPath(new URL("./define.ts", import.meta.url));

async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "crust-project-extensions-"));
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

/** `src/cli/build.ts`'s own resolution: the directory, and the config's names. */
function buildPath(projectDir: string, names?: readonly string[]): Promise<string[]> {
	return resolveExtensionFiles({ dir: join(projectDir, DEFAULT_EXTENSIONS_DIR), names });
}

describe("loadProjectExtensions", () => {
	test("dev and build resolve the same files, discovered and named", async () => {
		await withDir(async (projectDir) => {
			const dir = join(projectDir, DEFAULT_EXTENSIONS_DIR);
			await mkdir(dir, { recursive: true });
			await write(dir, "b.ts", extensionSource("second"));
			await write(dir, "a.ts", extensionSource("first"));
			await write(dir, "a.test.ts", extensionSource("test"));

			expect((await loadProjectExtensions({ projectDir })).files).toEqual(
				await buildPath(projectDir),
			);
			// The config's order is the load order on both paths, and a bare name gains its .ts.
			expect(
				(await loadProjectExtensions({ projectDir, names: ["b.ts", "a"] })).files,
			).toEqual(await buildPath(projectDir, ["b.ts", "a"]));
		});
	});

	test("a broken extension produces the same sentence on both paths", async () => {
		await withDir(async (projectDir) => {
			const missing = join(projectDir, DEFAULT_EXTENSIONS_DIR, "gone.ts");
			const dev = await loadProjectExtensions({ projectDir, names: ["gone.ts"] });

			// `crust build` refuses this config entry with exactly this line, and dev prints it.
			const buildFailure = `extensions entry ${missing} does not exist`;
			expect(extensionErrorLines(dev.errors)).toEqual([buildFailure]);
			expect(missingExtensionEntry(missing)).toBe(buildFailure);
			// The resolved list is the build's list even when the file is not there.
			expect(dev.files).toEqual(await buildPath(projectDir, ["gone.ts"]));

			// A file that is there but is not an extension: dev prints the loader's reason and
			// keeps the extensions that did load, which is what "dev keeps running" means.
			const dir = join(projectDir, DEFAULT_EXTENSIONS_DIR);
			await mkdir(dir, { recursive: true });
			const clock = await write(dir, "clock.ts", extensionSource("clock"));
			const broken = await write(dir, "broken.ts", "export const nope = 1;\n");

			const loaded = await loadProjectExtensions({ projectDir });
			expect(loaded.files).toEqual([broken, clock]);
			expect(loaded.loaded).toEqual([clock]);
			expect(loaded.extensions.map((extension) => extension.name)).toEqual(["clock"]);
			expect(extensionErrorLines(loaded.errors)[0]).toContain("no default export");
		});
	});
});
