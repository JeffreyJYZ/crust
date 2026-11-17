/**
 * The generated bindings module, run for real against a dylib compiled here. The two properties the
 * findings name are runtime ones: an ABI mismatch must fail when the module opens the file, and a rebuilt
 * dylib must answer after `reload()` instead of the symbol captured when the module was first imported.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ABI_SYMBOL, type SymbolSpec, writeBindings } from "./extension-bindings";
import { dylibSuffix, findTool } from "./extension-tools";

const CLANG = findTool("clang");

/** A C source exporting `answer` with `value`, plus the ABI marker when `abi` is given. */
function source(value: number, abi?: number): string {
	const marker =
		abi === undefined
			? ""
			: `#include <stdint.h>\nint32_t ${ABI_SYMBOL}(void) { return ${abi}; }\n`;
	return `#include <stdint.h>\n${marker}int32_t answer(void) { return ${value}; }\n`;
}

/** Compile `text` into `<dir>/math<dylibSuffix()>`, returning whether clang succeeded. */
async function buildDylib(dir: string, text: string): Promise<boolean> {
	const c = join(dir, "answer.c");
	await writeFile(c, text, "utf8");
	// `-dynamiclib` exists only in Apple's clang, so the flag follows the host here.
	const shared = process.platform === "darwin" ? "-dynamiclib" : "-shared";
	const result = Bun.spawnSync(["clang", shared, "-o", join(dir, `math${dylibSuffix()}`), c]);
	return result.exitCode === 0;
}

/** Import a freshly written module under a unique URL, since ESM caches by specifier. */
async function importFresh(path: string): Promise<Record<string, unknown>> {
	return (await import(`${path}?v=${crypto.randomUUID()}`)) as Record<string, unknown>;
}

const ANSWER: SymbolSpec[] = [{ name: "answer", args: [], returns: "i32" }];

describe("the generated module against a real dylib", () => {
	if (CLANG === undefined) {
		test.skip("skipped: clang is not on PATH");
	} else {
		test("reload() answers from a rebuilt dylib, and an ABI mismatch fails at import", async () => {
			const dir = await mkdtemp(join(tmpdir(), "crust-abi-"));
			try {
				expect(await buildDylib(dir, source(7, 2))).toBe(true);

				const ok = await writeBindings({
					outDir: dir,
					name: "math",
					symbols: [...ANSWER],
					abiVersion: 2,
				});
				const first = await importFresh(ok.path);
				expect((first.answer as () => number)()).toBe(7);

				// A rebuild that changes the answer: the already-opened image keeps the old one, which
				// is exactly the stale-symbol defect. `reload` closes and re-opens, so the new build
				// answers without a process restart.
				expect(await buildDylib(dir, source(42, 2))).toBe(true);
				expect((first.answer as () => number)()).toBe(7);
				(first.reload as () => void)();
				expect((first.answer as () => number)()).toBe(42);

				// A module generated for another ABI refuses the dylib rather than binding it.
				const wrong = await writeBindings({
					outDir: dir,
					name: "other",
					symbols: [...ANSWER],
					dylib: `math${dylibSuffix()}`,
					abiVersion: 9,
				});
				await expect(importFresh(wrong.path)).rejects.toThrow(
					/is ABI 2, this module was generated for 9/,
				);
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		}, 120_000);
	}

	test("a module with no abiVersion binds a dylib that exports no marker", async () => {
		if (CLANG === undefined) return;
		const dir = await mkdtemp(join(tmpdir(), "crust-abi-none-"));
		try {
			expect(await buildDylib(dir, source(11))).toBe(true);
			// The module is named `plain` but the file on disk is `math`; the default suffix is the point
			// here, and no abiVersion means no marker symbol is declared.
			const plain = await writeBindings({
				outDir: dir,
				name: "plain",
				symbols: [...ANSWER],
				dylib: `math${dylibSuffix()}`,
			});
			const module = await importFresh(plain.path);
			expect((module.answer as () => number)()).toBe(11);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
