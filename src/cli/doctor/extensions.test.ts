import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunResult } from "@/packaging/exec";
import { extensionsSection } from "./extensions";

async function withDir(body: (dir: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "crust-doctor-ext-"));
	try {
		await body(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

describe("extensionsSection", () => {
	test("a project with no native/ prints one line and reports no failures", async () => {
		await withDir(async (dir) => {
			const section = await extensionsSection(dir);
			expect(section.failures).toBe(0);
			expect(section.text).toBe(`extensions  no native/ directory in ${dir}`);
		});
	});

	test("reports each toolchain and fails the files whose compiler is missing", async () => {
		await withDir(async (dir) => {
			const native = join(dir, "native");
			await mkdir(native, { recursive: true });
			await writeFile(join(native, "add.rs"), "", "utf8");
			await writeFile(join(native, "math.zig"), "", "utf8");

			const exec = async (command: string[]): Promise<RunResult> => ({
				code: 0,
				stdout: command[0] === "rustc" ? "rustc 1.91.0\n" : "clang 17.0.0\n",
				stderr: "",
			});
			const section = await extensionsSection(dir, {
				exec,
				findTool: (tool) => (tool === "zig" ? undefined : `/fake/${tool}`),
			});

			expect(section.failures).toBe(1);
			expect(section.text).toContain("  zig    missing");
			expect(section.text).toContain("  rustc  found rustc 1.91.0");
			expect(section.text).toContain(
				`missing ${join(native, "math.zig")}  zig is not on PATH`,
			);
			expect(section.text).toContain(
				`ok      ${join(native, "add.rs")}  rustc rustc 1.91.0 can build it`,
			);
		});
	});
});
