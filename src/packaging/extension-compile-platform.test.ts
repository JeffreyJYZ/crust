/**
 * The three emitted names and the clang shared flag are platform facts, not host facts. They are
 * asserted with `platform` injected so a macOS CI run still proves the Linux and Windows command lines:
 * the pre-fix code emitted `.dylib` everywhere and passed `-dynamiclib`, which a Linux clang rejects.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileExtension } from "./extension-compile";
import type { RunResult } from "./exec";

const OK: RunResult = { code: 0, stdout: "", stderr: "" };

/** Records argv and answers as if the toolchain worked, without running one. */
function recorder() {
	const calls: string[][] = [];
	const exec = async (command: string[]): Promise<RunResult> => {
		calls.push(command);
		return OK;
	};
	return { calls, exec };
}

/** A temp directory that is removed even when the test fails. */
async function withDir(body: (dir: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "crust-compile-platform-"));
	try {
		await body(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

describe("the platform half of the compile contract", () => {
	test("the dylib suffix and the clang shared flag follow the platform", async () => {
		await withDir(async (dir) => {
			const source = join(dir, "math.c");
			await writeFile(source, "", "utf8");
			const { calls, exec } = recorder();
			const attempt = (platform: string) =>
				compileExtension({
					file: source,
					outDir: join(dir, platform),
					platform,
					exec,
					findTool: () => "/fake/clang",
				});

			const linux = await attempt("linux");
			expect(linux.ok && linux.output).toBe(join(dir, "linux", "math.so"));
			const windows = await attempt("win32");
			expect(windows.ok && windows.output).toBe(join(dir, "win32", "math.dll"));
			const darwin = await attempt("darwin");
			expect(darwin.ok && darwin.output).toBe(join(dir, "darwin", "math.dylib"));

			expect(calls).toEqual([
				["clang", "-shared", "-o", join(dir, "linux", "math.so"), source],
				["clang", "-shared", "-o", join(dir, "win32", "math.dll"), source],
				["clang", "-dynamiclib", "-o", join(dir, "darwin", "math.dylib"), source],
			]);
		});
	});

	test("zig and rustc emit the platform suffix, and rustc only prefixes lib off windows", async () => {
		await withDir(async (dir) => {
			const zig = join(dir, "math.zig");
			const rust = join(dir, "math.rs");
			await writeFile(zig, "", "utf8");
			await writeFile(rust, "", "utf8");
			const { calls, exec } = recorder();
			const attempt = (file: string, platform: string) =>
				compileExtension({
					file,
					outDir: join(dir, platform),
					platform,
					exec,
					findTool: () => "/fake/tool",
				});

			const linuxRust = await attempt(rust, "linux");
			expect(linuxRust.ok && linuxRust.output).toBe(join(dir, "linux", "libmath.so"));
			const windowsRust = await attempt(rust, "win32");
			expect(windowsRust.ok && windowsRust.output).toBe(join(dir, "win32", "math.dll"));
			const linuxZig = await attempt(zig, "linux");
			expect(linuxZig.ok && linuxZig.output).toBe(join(dir, "linux", "math.so"));

			expect(calls).toEqual([
				[
					"rustc",
					"--crate-type",
					"cdylib",
					"-O",
					"-o",
					join(dir, "linux", "libmath.so"),
					rust,
				],
				[
					"rustc",
					"--crate-type",
					"cdylib",
					"-O",
					"-o",
					join(dir, "win32", "math.dll"),
					rust,
				],
				[
					"zig",
					"build-lib",
					zig,
					"-dynamic",
					`-femit-bin=${join(dir, "linux", "math.so")}`,
					"-O",
					"ReleaseSafe",
				],
			]);
		});
	});

	test("the host default is the same contract, so a missing platform is not a silent macOS", async () => {
		await withDir(async (dir) => {
			const source = join(dir, "math.c");
			await writeFile(source, "", "utf8");
			const { calls, exec } = recorder();
			const suffix =
				process.platform === "win32"
					? "dll"
					: process.platform === "darwin"
						? "dylib"
						: "so";
			const shared = process.platform === "darwin" ? "-dynamiclib" : "-shared";
			const result = await compileExtension({
				file: source,
				outDir: dir,
				exec,
				findTool: () => "/fake/clang",
			});
			expect(result.ok && result.output).toBe(join(dir, `math.${suffix}`));
			expect(calls).toEqual([["clang", shared, "-o", join(dir, `math.${suffix}`), source]]);
		});
	});
});
