import { describe, expect, test } from "bun:test";
import { chmodSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dylibSuffix, findTool, toolFileNames } from "./extension-tools";

/** A temp directory that is removed even when the test fails. */
async function withDir(body: (dir: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "crust-tools-"));
	try {
		await body(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** `findTool` checks `X_OK`, so a fixture has to carry the bit a real install carries. */
async function executable(path: string): Promise<string> {
	await writeFile(path, "", "utf8");
	chmodSync(path, 0o755);
	return path;
}

/** The separator the platform under test joins PATH with; `delimiter` is the host's. */
function pathOf(...dirs: string[]): string {
	return dirs.join(process.platform === "win32" ? ";" : ":");
}

describe("toolFileNames", () => {
	test("windows resolves the PATHEXT names, everywhere else the bare name", () => {
		expect(toolFileNames("zig", "win32")).toEqual(["zig.exe", "zig.cmd", "zig.bat"]);
		expect(toolFileNames("zig", "darwin")).toEqual(["zig"]);
		expect(toolFileNames("zig", "linux")).toEqual(["zig"]);
	});

	test("the exe name is what windows actually installs", async () => {
		await withDir(async (dir) => {
			const exe = await executable(join(dir, "zig.exe"));
			// A bare-name probe is the pre-fix code: it looked for `zig` and found nothing, so doctor
			// reported every toolchain missing on a machine with all three installed.
			expect(findTool("zig", dir, "darwin")).toBeUndefined();
			expect(findTool("zig", dir, "win32")).toBe(exe);
		});
	});
});

describe("findTool on windows", () => {
	test("scans every PATH entry and reports a tool that is genuinely absent", async () => {
		await withDir(async (dir) => {
			const empty = join(dir, "empty");
			await mkdir(empty, { recursive: true });
			const exe = await executable(join(dir, "rustc.exe"));
			const path = pathOf(empty, dir);
			expect(findTool("rustc", path, "win32")).toBe(exe);
			expect(findTool("clang", path, "win32")).toBeUndefined();
		});
	});

	test("an empty PATH entry is skipped rather than resolving against the cwd", async () => {
		await withDir(async (dir) => {
			const exe = await executable(join(dir, "clang.exe"));
			expect(findTool("clang", pathOf("", dir), "win32")).toBe(exe);
		});
	});
});

describe("dylibSuffix", () => {
	test("darwin is .dylib, linux .so, windows .dll", () => {
		expect(dylibSuffix("darwin")).toBe(".dylib");
		expect(dylibSuffix("linux")).toBe(".so");
		expect(dylibSuffix("win32")).toBe(".dll");
	});

	test("the named file is a real path, so the compiler's output can be stat-ed", async () => {
		await withDir(async (dir) => {
			const file = await executable(join(dir, `math${dylibSuffix()}`));
			expect((await stat(file)).size).toBe(0);
		});
	});
});
