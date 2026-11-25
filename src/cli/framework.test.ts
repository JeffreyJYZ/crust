/**
 * The compiled framework cache is planted by the executable, not trusted from a shared /tmp.
 * Every hostile case here creates the exact path the generated entry would import from and proves
 * the cache refuses it instead of handing its bytes to `bun build`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
	chmodSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crustRoot } from "./util.ts";
import { frameworkCacheDir, materialiseFramework } from "./framework.ts";

const roots: string[] = [];

function root(): string {
	const dir = mkdtempSync(join(tmpdir(), "crust-framework-cache-"));
	roots.push(dir);
	return dir;
}

afterAll(() => {
	for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("compiled framework cache", () => {
	test("materialises a private tree once and reuses the same path", async () => {
		const cache = root();
		const target = await materialiseFramework(cache);
		const again = await materialiseFramework(cache);
		expect(again).toBe(target);
		expect(lstatSync(target).mode & 0o777).toBe(0o700);
		const runtime = join(target, "src", "runtime.ts");
		expect(lstatSync(runtime).mode & 0o777).toBe(0o600);
		expect(readFileSync(runtime, "utf8")).toBe(
			readFileSync(join(crustRoot, "src", "runtime.ts"), "utf8"),
		);
	});

	test("HOSTILE CONTENT: planted runtime bytes behind a valid marker are refused", async () => {
		const cache = root();
		const target = await materialiseFramework(cache);
		const runtime = join(target, "src", "runtime.ts");
		const hostile = "export const startApp = () => { throw new Error('planted') };\n";
		writeFileSync(runtime, hostile, { mode: 0o600 });
		await expect(materialiseFramework(cache)).rejects.toThrow(
			"does not match the shipped sources",
		);
		// The planted bytes stay on disk; nothing was silently imported from them.
		expect(readFileSync(runtime, "utf8")).toBe(hostile);
	});

	test("HOSTILE SYMLINK: lstat refuses a planted cache directory", async () => {
		const cache = root();
		const elsewhere = join(cache, "elsewhere");
		mkdirElsewhere(elsewhere);
		symlinkSync(elsewhere, frameworkCacheDir(cache));
		await expect(materialiseFramework(cache)).rejects.toThrow("not a directory");
		expect(lstatSync(frameworkCacheDir(cache)).isSymbolicLink()).toBe(true);
	});

	test("a group or world writable cache directory is refused", async () => {
		const cache = root();
		mkdirElsewhere(frameworkCacheDir(cache));
		chmodSync(frameworkCacheDir(cache), 0o777);
		await expect(materialiseFramework(cache)).rejects.toThrow("not private to this user");
	});
});

function mkdirElsewhere(path: string): void {
	mkdirSync(path, { recursive: true, mode: 0o700 });
}
