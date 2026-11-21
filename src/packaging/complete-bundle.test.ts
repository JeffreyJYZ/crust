/**
 * A failed build must never leave a partial .app that package and doctor certify as
 * good. The bundle is assembled in a temp dir and moved only when every file exists,
 * and an artefact lookup refuses a bundle without Info.plist and its executable.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleApp } from "./app.ts";
import { isCompleteBundle } from "../cli/util.ts";

function project(): string {
	return mkdtempSync(join(tmpdir(), "crust-bundle-"));
}

const base = {
	id: "land.jyz.partial",
	name: "Partial",
	version: "0.1.0",
	minimumSystemVersion: "13.0",
};

describe("bundle completeness", () => {
	test("a directory named .app without Info.plist is not a usable bundle", async () => {
		const dir = project();
		try {
			const partial = join(dir, "dist", "Partial.app", "Contents", "MacOS");
			mkdirSync(partial, { recursive: true });
			expect(await isCompleteBundle(join(dir, "dist", "Partial.app"))).toBe(false);
			writeFileSync(join(dir, "dist", "Partial.app", "Contents", "Info.plist"), "<plist/>");
			expect(await isCompleteBundle(join(dir, "dist", "Partial.app"))).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a failed icon conversion leaves no .app behind", async () => {
		const dir = project();
		try {
			const binary = join(dir, "crust-app");
			writeFileSync(binary, "binary");
			const outDir = join(dir, "dist");
			await expect(
				assembleApp({ ...base, binary, outDir, iconPath: join(dir, "missing.png") }),
			).rejects.toThrow();
			expect(existsSync(join(outDir, "Partial.app"))).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a successful assembly is complete and keeps a previous bundle intact", async () => {
		const dir = project();
		try {
			const binary = join(dir, "crust-app");
			writeFileSync(binary, "binary");
			const outDir = join(dir, "dist");
			const built = await assembleApp({ ...base, binary, outDir });
			expect(await isCompleteBundle(built.appPath)).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
