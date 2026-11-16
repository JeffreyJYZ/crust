/**
 * The trap scan: only an app directory is walked, only the app's own source is
 * read, and prose about a trap is not the trap.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { project, runDoctor } from "./fixtures.ts";
import { notScanned, scanTraps, sourceSection } from "./scan.ts";

const TRAP = "\tobj_t window = [[NSWindow alloc] init];\n";

async function withDir(body: (dir: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "crust-doctor-scan-"));
	try {
		await body(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

async function write(dir: string, path: string, text: string): Promise<void> {
	await mkdir(dirname(join(dir, path)), { recursive: true });
	await writeFile(join(dir, path), text, "utf8");
}

const APP_CONFIG = `export default {
	app: { id: "dev.crust.test", name: "Test", version: "0.1.0" },
	windows: [{ label: "main" }],
};
`;

describe("sourceSection", () => {
	test("without a config there is no scan and no trap failure", async () => {
		await withDir(async (dir) => {
			await write(dir, "src/leak.c", TRAP);

			const checks = await sourceSection(dir, false);

			expect(checks).toEqual([notScanned()]);
			expect(checks.filter((check) => check.status === "fail")).toEqual([]);
			expect(checks[0]?.detail).toContain("not scanned");
			expect(checks[0]?.detail).toContain("not an app directory");
		});
	});

	test("an app directory with a deliberate trap is one failure naming the file", async () => {
		await withDir(async (dir) => {
			await write(dir, "src/window.c", TRAP);

			const checks = await sourceSection(dir, true);
			const failures = checks.filter((check) => check.status === "fail");

			expect(failures).toHaveLength(1);
			expect(failures[0]?.detail).toContain("src/window.c:1");
			expect(failures[0]?.detail).toContain("initWithContentRect:");
		});
	});

	test("a clean app directory reports what it scanned instead of silence", async () => {
		await withDir(async (dir) => {
			await write(dir, "src/main.ts", "export const main = 1;\n");

			const checks = await scanTraps(dir);

			expect(checks).toHaveLength(1);
			expect(checks[0]?.status).toBe("ok");
			expect(checks[0]?.detail).toContain("scanned 1 file, no traps");
		});
	});
});

describe("scanTraps exclusions", () => {
	test("node_modules is not the app's source", async () => {
		await withDir(async (dir) => {
			await write(dir, "node_modules/dep/index.c", TRAP);
			await write(dir, "src/main.ts", "export const main = 1;\n");

			const checks = await scanTraps(dir);

			expect(checks.filter((check) => check.status === "fail")).toEqual([]);
			expect(checks[0]?.detail).toContain("scanned 1 file, no traps");
		});
	});

	test("a nested checkout is a separate project, not this app", async () => {
		await withDir(async (dir) => {
			await write(dir, "vendor/sibling/package.json", '{ "name": "sibling" }\n');
			await write(dir, "vendor/sibling/broken.c", TRAP);
			await write(dir, "dist/bundled.c", TRAP);

			const checks = await scanTraps(dir);

			expect(checks.filter((check) => check.status === "fail")).toEqual([]);
		});
	});

	test("a comment naming the trap is not the trap", async () => {
		await withDir(async (dir) => {
			await write(
				dir,
				"src/prelude.c",
				"// Never write [[NSWindow alloc] init] here: AppKit aborts from its own thread.\n" +
					"/* and do not pass an NSString across bun:ffi either */\n" +
					"int ready(void) { return 1; }\n",
			);

			const checks = await scanTraps(dir);

			expect(checks.filter((check) => check.status === "fail")).toEqual([]);
			expect(checks[0]?.status).toBe("ok");
		});
	});

	test("an NSString built in C is a hint, not a failure", async () => {
		await withDir(async (dir) => {
			await write(
				dir,
				"src/strings.c",
				'\tobj_t value = objc_msgSend(cls, sel, stringWithUTF8String: "hi");\n',
			);

			const checks = await scanTraps(dir);

			expect(checks.filter((check) => check.status === "fail")).toEqual([]);
			expect(checks[0]?.status).toBe("note");
			expect(checks[0]?.detail).toContain("cannot see that boundary");
		});
	});
});

describe("crust doctor from the command line", () => {
	test("a directory with no config is not scanned, so a framework tree has no trap failures", async () => {
		const dir = await project();
		await write(dir, "notes.txt", "hello\n");
		await write(dir, "src/platform/shim/10_prelude.c", TRAP);

		const run = await runDoctor(dir);

		expect(run.stdout).toContain("not scanned");
		expect(run.stdout).toContain("not an app directory");
		expect(run.stdout).not.toContain("trap      [fail]");
		expect(run.stderr).not.toContain("check failed");
	});

	test("an app directory with a trap fails once and names the file", async () => {
		const dir = await project();
		await write(dir, "crust.config.ts", APP_CONFIG);
		await write(dir, "main.ts", "await app.run();\n");
		await write(dir, "src/window.c", TRAP);

		const run = await runDoctor(dir);

		expect(run.code).toBe(1);
		expect(run.stdout).toContain("src/window.c:1");
		expect(run.stderr).toContain("1 check failed");
	});
});
