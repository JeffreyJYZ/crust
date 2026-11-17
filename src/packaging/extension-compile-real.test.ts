/**
 * The argv assertions in `extension-compile.test.ts` prove the command line, never that the command line
 * compiles. This block runs the real compiler and then does what the framework does with its output:
 * `dlopen` it and call the symbol. A missing toolchain is a named skip, so a machine without Zig or Rust
 * still reports why instead of passing quietly.
 */
import { describe, expect, test } from "bun:test";
import { dlopen, FFIType } from "bun:ffi";
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compileExtension } from "./extension-compile";
import { REAL, withDir } from "./extension-test-kit";
import { findTool } from "./extension-tools";

describe("compileExtension with the real toolchain", () => {
	for (const entry of REAL) {
		const label = `${entry.tool} compiles a dylib that bun:ffi dlopens and calls`;
		if (findTool(entry.tool) === undefined) {
			test.skip(`${label} — skipped: ${entry.tool} is not on PATH`);
			continue;
		}
		test(
			label,
			async () => {
				await withDir(async (dir) => {
					const file = join(dir, entry.file);
					await writeFile(file, entry.source, "utf8");
					const result = await compileExtension({ file, outDir: join(dir, "out") });
					expect(result.ok).toBe(true);
					if (!result.ok) return;

					expect((await stat(result.output)).size).toBeGreaterThan(1024);
					const ffi = dlopen(result.output, {
						answer: { args: [], returns: FFIType.i32 },
					});
					try {
						expect(ffi.symbols.answer()).toBe(42);
					} finally {
						ffi.close();
					}
				});
				// A cold rustc or zig on a CI runner spends several seconds before it emits anything,
				// which is past bun's 5 s default: the first run of this test timed out at 5000.50 ms on
				// macOS. The compile is real work, so it gets a real budget.
			},
			120_000,
		);
	}
});
