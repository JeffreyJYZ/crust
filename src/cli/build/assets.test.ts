/**
 * An asset that cannot be embedded must fail the build. The old walk skipped symlinks, so a page
 * shipped without a stylesheet or image while `crust build` still printed a successful file count.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectAssets } from "./assets.ts";

const roots: string[] = [];

async function assetsDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "crust-assets-"));
	roots.push(dir);
	return dir;
}

afterAll(async () => {
	await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("collectAssets refuses what it cannot embed", () => {
	test("a symlinked stylesheet is a build failure, not a silent omission", async () => {
		const dir = await assetsDir();
		await writeFile(join(dir, "index.html"), "<h1>hello</h1>\n", "utf8");
		await writeFile(join(dir, "theme.css"), "body { color: red }\n", "utf8");
		await symlink(join(dir, "theme.css"), join(dir, "linked.css"));

		const result = await collectAssets(dir).catch((error: unknown) => error);
		if (!(result instanceof Error)) {
			throw new Error(
				`expected a refusal; got ${(result as { length: number }).length} assets and silently omitted linked.css`,
			);
		}
		expect(result.message).toContain("refusing symlink");
		expect(result.message).toContain("linked.css");
	});

	test("a dangling symlink is refused by name", async () => {
		const dir = await assetsDir();
		await symlink(join(dir, "not-there.png"), join(dir, "broken.png"));

		const result = await collectAssets(dir).catch((error: unknown) => error);
		if (!(result instanceof Error))
			throw new Error("expected a refusal for a dangling symlink");
		expect(result.message).toContain("broken.png");
	});

	test("regular files still embed with their request paths", async () => {
		const dir = await assetsDir();
		await writeFile(join(dir, "index.html"), "<h1>hello</h1>\n", "utf8");
		const files = await collectAssets(dir);
		expect(files.map((file) => file.path)).toEqual(["/index.html"]);
		expect(files[0]!.text).toBe(true);
	});
});
