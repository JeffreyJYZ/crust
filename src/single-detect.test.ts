/**
 * Detection refusals: a single-file positional is a guess, so every ambiguity must be named instead
 * of silently picking a shape. These paths had no test of their own; the happy path lives in
 * `single-html.test.ts` and `single-page.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectSingle } from "./single-detect.ts";

async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "crust-single-detect-"));
	try {
		await run(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function message(result: Awaited<ReturnType<typeof detectSingle>>): string {
	if (result.kind !== "error") throw new Error(`expected a refusal, got ${result.kind}`);
	return result.message;
}

describe("detectSingle refusals", () => {
	test("a single file cannot be combined with --config or --entry", async () => {
		await withDir(async (dir) => {
			await writeFile(join(dir, "app.tsx"), "export default 1;\n", "utf8");
			expect(message(await detectSingle({ single: "app.tsx", dir, config: "crust.json" }))).toContain(
				"--config",
			);
			expect(message(await detectSingle({ single: "app.tsx", dir, entry: "main.js" }))).toContain(
				"--entry",
			);
		});
	});

	test("an unsupported extension is refused with the extension it saw", async () => {
		await withDir(async (dir) => {
			await writeFile(join(dir, "notes.md"), "hello\n", "utf8");
			expect(message(await detectSingle({ single: "notes.md", dir }))).toContain(".md");
		});
	});

	test("a file beside a crust config is refused instead of guessed", async () => {
		await withDir(async (dir) => {
			await writeFile(join(dir, "app.tsx"), "export default 1;\n", "utf8");
			await writeFile(join(dir, "crust.config.ts"), "export default {};\n", "utf8");
			const refusal = message(await detectSingle({ single: "app.tsx", dir }));
			expect(refusal).toContain("app.tsx");
			expect(refusal).toContain("crust.config.ts");
		});
	});
});
