/**
 * Shared fixtures for the extension-compile suites. The real-toolchain cases live in
 * `extension-compile-real.test.ts` because `extension-compile.test.ts` passes the 200-line cap — the fix
 * for the cap is another file, never a trimmed case — so the temp-dir helper and the toolchain table live
 * here instead of being copied into each half.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A temp directory that is removed even when the test fails. */
export async function withDir(body: (dir: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "crust-compile-"));
	try {
		await body(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/**
 * One source per compiler, each exporting `answer()` returning 42, so a dylib that loads but binds the
 * wrong signature reads something else and the test says so. `clang` is here because the C command line
 * is the one whose flag differs per platform: an argv assertion passes on a wrong flag, and only a real
 * compile catches it.
 */
export const REAL = [
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
	{
		tool: "clang",
		file: "answer.c",
		source: "#include <stdint.h>\nint32_t answer(void) {\n\treturn 42;\n}\n",
	},
] as const;
