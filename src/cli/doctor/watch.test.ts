/**
 * The watcher's `.ts` trap: which files it counts, and what the one-line note
 * says about them.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pageSideTypeScript, watcherNote } from "../doctor.ts";
import { project } from "./fixtures.ts";

describe("pageSideTypeScript", () => {
	test("finds page-side .ts and skips the entry, config, tests, declarations and watched-out dirs", async () => {
		const dir = await project();
		const files: Record<string, string> = {
			"src/App.tsx": "export default 1;\n",
			"src/bridge.ts": "export const bridge = 1;\n",
			"src/notes.ts": "export const notes = 1;\n",
			"src/notes.test.ts": "// test\n",
			"src/types.d.ts": "declare const x: number;\n",
			"desktop/main.ts": "// entry\n",
			"crust.config.ts": "export default {};\n",
			"vite.config.ts": "export default {};\n",
			"public/handwritten.ts": "export const x = 1;\n",
			"node_modules/dep/index.ts": "export const y = 1;\n",
			"dist/bundled.ts": "export const z = 1;\n",
		};
		for (const [path, text] of Object.entries(files)) {
			await mkdir(dirname(join(dir, path)), { recursive: true });
			await writeFile(join(dir, path), text, "utf8");
		}

		expect(await pageSideTypeScript(dir, join(dir, "desktop/main.ts"))).toEqual([
			"src/bridge.ts",
			"src/notes.ts",
		]);
	});

	test("without an entry, a .ts module at the project root is reported too", async () => {
		const dir = await project();
		await mkdir(join(dir, "src"), { recursive: true });
		await writeFile(join(dir, "src", "bridge.ts"), "export const bridge = 1;\n", "utf8");
		await writeFile(join(dir, "main.ts"), "// entry\n", "utf8");

		expect(await pageSideTypeScript(dir)).toEqual(["main.ts", "src/bridge.ts"]);
	});

	test("a dev-server layout with no page-side .ts reports nothing", async () => {
		const dir = await project();
		await mkdir(join(dir, "src"), { recursive: true });
		await writeFile(join(dir, "src", "App.tsx"), "export default 1;\n", "utf8");
		await writeFile(join(dir, "src", "main.ts"), "// entry\n", "utf8");

		expect(await pageSideTypeScript(dir, join(dir, "src", "main.ts"))).toEqual([]);
	});
});

describe("watcherNote", () => {
	test("is a note with a count and the first three names, and says how to fix it", () => {
		const check = watcherNote(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]);

		expect(check.name).toBe("dev watch");
		expect(check.status).toBe("note");
		expect(check.detail).toContain("4 page-side .ts files");
		expect(check.detail).toContain("src/a.ts, src/b.ts, src/c.ts, +1 more");
		expect(check.detail).toContain("rename them .tsx");
		expect(check.detail).toContain("public/");
	});

	test("singular for one file", () => {
		expect(watcherNote(["src/bridge.ts"]).detail).toContain(
			"1 page-side .ts file (src/bridge.ts)",
		);
	});
});
