import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverExtensions, findTool } from "./extensions";

/** A temp directory that is removed even when the test fails. */
async function withDir(body: (dir: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "crust-ext-"));
	try {
		await body(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

describe("discoverExtensions", () => {
	test("classifies by extension, skips build output, and sorts", async () => {
		await withDir(async (dir) => {
			const native = join(dir, "native");
			await mkdir(join(native, "sub"), { recursive: true });
			await mkdir(join(native, "target"), { recursive: true });
			for (const name of ["b.zig", "a.zig", "sub/e.zig", "c.rs", "d.c", "README.md"]) {
				await writeFile(join(native, name), "", "utf8");
			}
			await writeFile(join(native, "target/ignored.rs"), "", "utf8");

			const found = await discoverExtensions({ dir: native });
			const zig = [join(native, "a.zig"), join(native, "b.zig"), join(native, "sub/e.zig")];
			expect(found).toEqual({ zig, rust: [join(native, "c.rs")], c: [join(native, "d.c")] });
		});
	});

	test("accepts a project root, and a missing directory is empty", async () => {
		await withDir(async (dir) => {
			await mkdir(join(dir, "native"), { recursive: true });
			await writeFile(join(dir, "native/math.zig"), "", "utf8");
			expect((await discoverExtensions({ dir })).zig).toEqual([join(dir, "native/math.zig")]);
			const absent = await discoverExtensions({ dir: join(dir, "absent") });
			expect(absent).toEqual({ zig: [], rust: [], c: [] });
		});
	});
});

test("findTool finds a tool every macOS ships and misses one it does not", () => {
	expect(findTool("sh")).toEndWith("/sh");
	expect(findTool("crust-not-a-real-tool-xyz")).toBeUndefined();
});
