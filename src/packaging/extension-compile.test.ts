import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compileExtension } from "./extension-compile";
import type { RunResult } from "./exec";
import { withDir } from "./extension-test-kit";
import { dylibSuffix, findTool } from "./extension-tools";

const OK: RunResult = { code: 0, stdout: "", stderr: "" };

/** Records argv and answers as if the toolchain worked, without running one. */
function recorder(answer: (command: string[]) => RunResult = () => OK) {
	const calls: string[][] = [];
	const exec = async (command: string[]): Promise<RunResult> => {
		calls.push(command);
		return answer(command);
	};
	return { calls, exec };
}

/** Compile `name` with a fake lookup that reports only `tool` as installed. */
async function build(dir: string, name: string, tool: string) {
	const file = join(dir, name);
	await writeFile(file, "", "utf8");
	const out = resolve(join(dir, "out"));
	const { calls, exec } = recorder();
	const result = await compileExtension({
		file,
		outDir: out,
		exec,
		findTool: (wanted) => (wanted === tool ? `/fake/${tool}` : undefined),
	});
	return { file, out, calls, result };
}

describe("compileExtension", () => {
	test("zig argv, and the emitted name carries the host's dylib suffix", async () => {
		await withDir(async (dir) => {
			const { file, out, calls, result } = await build(dir, "math.zig", "zig");
			const emitted = join(out, `math${dylibSuffix()}`);
			expect(calls).toEqual([
				[
					"zig",
					"build-lib",
					file,
					"-dynamic",
					`-femit-bin=${emitted}`,
					"-O",
					"ReleaseSafe",
				],
			]);
			expect(result).toEqual({ ok: true, file, output: emitted, tool: "zig" });
		});
	});

	test("rust argv, and rustc prefixes the cdylib with lib", async () => {
		await withDir(async (dir) => {
			const { file, out, calls, result } = await build(dir, "math.rs", "rustc");
			const emitted = join(out, `libmath${dylibSuffix()}`);
			expect(calls).toEqual([["rustc", "--crate-type", "cdylib", "-O", "-o", emitted, file]]);
			expect(result.ok && result.output).toBe(emitted);
		});
	});

	test("clang argv", async () => {
		await withDir(async (dir) => {
			const { file, out, calls, result } = await build(dir, "math.c", "clang");
			const shared = process.platform === "darwin" ? "-dynamiclib" : "-shared";
			expect(calls).toEqual([
				["clang", shared, "-o", join(out, `math${dylibSuffix()}`), file],
			]);
			expect(result.ok && result.tool).toBe("clang");
		});
	});

	test("a missing tool, a bad extension and a failed compile are verdicts, not throws", async () => {
		await withDir(async (dir) => {
			const zig = join(dir, "math.zig");
			const notes = join(dir, "notes.txt");
			await writeFile(zig, "", "utf8");
			await writeFile(notes, "", "utf8");
			const { calls, exec } = recorder(() => ({
				code: 1,
				stdout: "",
				stderr: "error: expected ';'",
			}));
			const attempt = (file: string, tool?: string) =>
				compileExtension({
					file,
					outDir: dir,
					exec,
					findTool: (wanted) => (tool === wanted ? `/fake/${wanted}` : undefined),
				});

			const absent = await attempt(zig);
			expect(calls).toEqual([]);
			expect(!absent.ok && absent.reason).toBe(
				"zig is not on PATH, so math.zig cannot be built",
			);
			expect(!absent.ok && absent.requires).toEqual(["zig"]);

			const wrong = await attempt(notes);
			expect(!wrong.ok && wrong.reason).toBe("notes.txt is not .zig, .rs or .c");
			expect(!wrong.ok && wrong.requires).toEqual([]);

			const failed = await attempt(zig, "zig");
			expect(!failed.ok && failed.reason).toBe("zig failed (exit 1): error: expected ';'");
		});
	});
});

/**
 * The command line is asserted in `extension-compile.test.ts`; the platform half is in
 * `extension-compile-platform.test.ts` and the block that actually runs a compiler is in
 * `extension-compile-real.test.ts`, so no single suite passes the 200-line cap.
 */
test("findTool is the real lookup this suite drives", () => {
	expect(findTool("sh")).toEndWith("/sh");
});
