/**
 * A single file carries no extension registry, so an `extensions/` directory beside it must be a
 * named refusal rather than a silent drop — on both halves, because `crust dev app.tsx` and
 * `crust build app.tsx` call the same `buildPage`.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildPage } from "./single-build.ts";
import { detectSingle, type SingleApp } from "./single-detect.ts";

async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "crust-single-extensions-"));
	try {
		await run(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

async function write(dir: string, name: string, contents: string): Promise<string> {
	const file = join(dir, name);
	await writeFile(file, contents, "utf8");
	return file;
}

/** Detect the single file in `dir`, failing loudly unless it is an app. */
async function app(dir: string, name: string): Promise<SingleApp> {
	const detection = await detectSingle({ single: name, dir });
	if (detection.kind !== "app") throw new Error(`expected an app, got ${detection.kind}`);
	return detection.app;
}

describe("buildPage with extensions beside the file", () => {
	test("refuses, naming the file, on the dev half and the build half alike", async () => {
		await withDir(async (dir) => {
			await write(dir, "hello.html", "<h1>hello</h1>\n");
			await mkdir(join(dir, "extensions"), { recursive: true });
			const extension = await write(dir, "extensions/clock.ts", "export default 1;\n");

			const single = await app(dir, "hello.html");
			for (const dev of [true, false]) {
				const failure = await buildPage(single, { dev }).catch((error: unknown) => error);
				expect(failure).toBeInstanceOf(Error);
				expect((failure as Error).message).toContain(
					"single-file mode carries no extensions",
				);
				expect((failure as Error).message).toContain(extension);
			}
		});
	});

	test("a file with no extensions beside it still builds", async () => {
		await withDir(async (dir) => {
			await write(dir, "plain.html", "<h1>plain</h1>\n");
			const build = await buildPage(await app(dir, "plain.html"), { dev: true });
			expect(build.entry).toBe("index.html");
		});
	});
});
