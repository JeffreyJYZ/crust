import { describe, expect, test } from "bun:test";
import { dlopen, FFIType } from "bun:ffi";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compileExtension } from "./extension-compile";
import type { RunResult } from "./exec";
import { findTool } from "./extension-tools";

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

/** A temp directory that is removed even when the test fails. */
async function withDir(body: (dir: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "crust-compile-"));
	try {
		await body(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
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
	test("zig argv, and the emitted name carries .dylib", async () => {
		await withDir(async (dir) => {
			const { file, out, calls, result } = await build(dir, "math.zig", "zig");
			const emitted = join(out, "math.dylib");
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
			const emitted = join(out, "libmath.dylib");
			expect(calls).toEqual([["rustc", "--crate-type", "cdylib", "-O", "-o", emitted, file]]);
			expect(result.ok && result.output).toBe(emitted);
		});
	});

	test("clang argv", async () => {
		await withDir(async (dir) => {
			const { file, out, calls, result } = await build(dir, "math.c", "clang");
			expect(calls).toEqual([["clang", "-dynamiclib", "-o", join(out, "math.dylib"), file]]);
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
 * The argv assertions above prove the command line, never that the command line compiles. This block
 * runs the real compiler and then does what the framework does with its output: `dlopen` it and call
 * the symbol. A missing toolchain is a named skip, so a machine without Zig or Rust still reports
 * why instead of passing quietly.
 */
const REAL = [
	{
		tool: "zig",
		file: "answer.zig",
		source: "export fn answer() i32 {\n\treturn 42;\n}\n",
	},
	{
		tool: "rustc",
		file: "answer.rs",
		source: '#[no_mangle]\npub extern "C" fn answer() -> i32 {\n\t42\n}\n',
	},
] as const;

describe("compileExtension with the real toolchain", () => {
	for (const entry of REAL) {
		const label = `${entry.tool} compiles a dylib that bun:ffi dlopens and calls`;
		if (findTool(entry.tool) === undefined) {
			test.skip(`${label} — skipped: ${entry.tool} is not on PATH`);
			continue;
		}
		test(label, async () => {
			await withDir(async (dir) => {
				const file = join(dir, entry.file);
				await writeFile(file, entry.source, "utf8");
				const result = await compileExtension({ file, outDir: join(dir, "out") });
				expect(result.ok).toBe(true);
				if (!result.ok) return;

				expect((await stat(result.output)).size).toBeGreaterThan(1024);
				const ffi = dlopen(result.output, { answer: { args: [], returns: FFIType.i32 } });
				try {
					expect(ffi.symbols.answer()).toBe(42);
				} finally {
					ffi.close();
				}
			});
		});
	}
});
