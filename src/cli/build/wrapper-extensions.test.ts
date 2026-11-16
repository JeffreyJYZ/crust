/**
 * The extension block's one ordering rule: declaring it loads nothing, and only the register line
 * does. A compiled app re-runs its own executable as the crash guard, so an extension that a static
 * import evaluated would run its module body in a process that opens no window — the guard check the
 * wrapper writes above this block is what skips it, and both halves are launched here for real.
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { extensionEntrySource, renderExtensionImports } from "@/extensions/entry-source.ts";

const guardPath = fileURLToPath(new URL("../../runtime-crash-guard.ts", import.meta.url));

/** An extension that records its own evaluation, so a launch that never loads it leaves no file. */
async function fakeExtension(dir: string, log: string): Promise<string> {
	const path = join(dir, "clock.ts");
	await writeFile(
		path,
		[
			'import { appendFileSync } from "node:fs";',
			`appendFileSync(${JSON.stringify(log)}, "extension ");`,
			'export default { name: "clock", commands: {} };',
			"",
		].join("\n"),
	);
	return path;
}

/** Run a generated entry with `env`, returning its exit code. */
async function launch(entry: string, env: Record<string, string> = {}): Promise<number> {
	const child = Bun.spawn([process.execPath, entry], {
		env: { ...process.env, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
	return await child.exited;
}

describe("the extension block", () => {
	test("declaring it evaluates no extension module", async () => {
		const dir = await mkdtemp(join(tmpdir(), "crust-extension-block-"));
		try {
			const log = join(dir, "side-effects.log");
			const extension = await fakeExtension(dir, log);
			const entry = join(dir, "block.ts");
			await writeFile(entry, extensionEntrySource({ files: [extension], projectDir: dir }));

			expect(await launch(entry)).toBe(0);
			expect(existsSync(log)).toBe(false);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}, 20_000);

	test("a marked launch registers nothing, and a normal launch registers once", async () => {
		const dir = await mkdtemp(join(tmpdir(), "crust-extension-guard-"));
		try {
			const log = join(dir, "side-effects.log");
			const extension = await fakeExtension(dir, log);
			const entry = join(dir, "crust-entry.ts");
			await writeFile(
				entry,
				[
					'import { appendFileSync } from "node:fs";',
					`import { runCrashGuardIfMarked } from ${JSON.stringify(guardPath)};`,
					"if (await runCrashGuardIfMarked()) process.exit(0);",
					extensionEntrySource({ files: [extension], projectDir: dir }).trimEnd(),
					"const registry = {",
					`\tregister: (...plugins: { name: string }[]) => appendFileSync(${JSON.stringify(log)}, plugins.map((plugin) => plugin.name).join(",") + " "),`,
					"};",
					renderExtensionImports([extension]),
					"",
				].join("\n"),
			);

			// 999999 is above this machine's pid ceiling, so the watched pid is already gone and
			// the guard finishes at once instead of polling for a live process.
			expect(
				await launch(entry, {
					CRUST_CRASH_GUARD: "999999",
					CRUST_CRASH_GUARD_ROOT: join(dir, "app-data"),
				}),
			).toBe(0);
			expect(existsSync(log)).toBe(false);

			// The control: without the marker the same entry loads the extension and registers it.
			expect(await launch(entry)).toBe(0);
			expect((await readFile(log, "utf8")).trim().split(" ")).toEqual(["extension", "clock"]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}, 20_000);
});
