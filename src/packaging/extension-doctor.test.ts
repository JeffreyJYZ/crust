import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeExtensions, doctorExtensions } from "./extension-doctor";
import type { RunResult } from "./exec";

/** Records argv and answers as if the toolchain worked, without running one. */
function recorder(answer: (command: string[]) => RunResult) {
	const calls: string[][] = [];
	const exec = async (command: string[]): Promise<RunResult> => {
		calls.push(command);
		return answer(command);
	};
	return { calls, exec };
}

/** A temp directory that is removed even when the test fails. */
async function withDir(body: (dir: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "crust-doctor-"));
	try {
		await body(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

describe("doctorExtensions", () => {
	test("reports each toolchain and one verdict per file, invoking only --version", async () => {
		await withDir(async (dir) => {
			const native = join(dir, "native");
			await mkdir(native, { recursive: true });
			await writeFile(join(native, "math.zig"), "", "utf8");
			await writeFile(join(native, "add.rs"), "", "utf8");
			const { calls, exec } = recorder((command) => ({
				code: 0,
				stdout: command[0] === "rustc" ? "rustc 1.91.0\n" : "clang 17.0.0\n",
				stderr: "",
			}));

			const report = await doctorExtensions({
				dir: native,
				exec,
				findTool: (tool) => (tool === "zig" ? undefined : `/fake/${tool}`),
			});

			expect(calls).toEqual([
				["rustc", "--version"],
				["clang", "--version"],
			]);
			expect(report.toolchains).toEqual([
				{ tool: "zig", found: false, version: "" },
				{ tool: "rustc", found: true, version: "rustc 1.91.0" },
				{ tool: "clang", found: true, version: "clang 17.0.0" },
			]);
			expect(report.files).toEqual([
				{
					file: join(native, "add.rs"),
					kind: "rust",
					ok: true,
					detail: "rustc rustc 1.91.0 can build it",
				},
				{
					file: join(native, "math.zig"),
					kind: "zig",
					ok: false,
					detail: "zig is not on PATH",
				},
			]);

			const block = describeExtensions(report);
			expect(block).toContain("  zig    missing");
			expect(block).toContain(`missing ${join(native, "math.zig")}  zig is not on PATH`);
		});
	});
});
