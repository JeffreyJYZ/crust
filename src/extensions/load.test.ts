import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadExtensions, resolveExtensionFiles } from "./load.ts";

const definePath = fileURLToPath(new URL("./define.ts", import.meta.url));
const pluginPath = fileURLToPath(new URL("../plugins/define.ts", import.meta.url));

async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "crust-extensions-"));
	try {
		await run(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function extensionSource(name: string): string {
	return [
		`import { defineExtension } from ${JSON.stringify(definePath)};`,
		`export default defineExtension({ name: ${JSON.stringify(name)}, commands: { ping: () => "pong" } });`,
		"",
	].join("\n");
}

async function write(dir: string, name: string, source: string): Promise<string> {
	const path = join(dir, name);
	await writeFile(path, source, "utf8");
	return path;
}

describe("loadExtensions", () => {
	test("loads every *.ts extension in filename order", async () => {
		await withDir(async (dir) => {
			await write(dir, "b.ts", extensionSource("second"));
			await write(dir, "a.ts", extensionSource("first"));
			await write(dir, "notes.md", "not an extension");
			const { extensions, errors } = await loadExtensions({ dir });
			expect(errors).toEqual([]);
			expect(extensions.map((extension) => extension.name)).toEqual(["first", "second"]);
		});
	});

	test("a file with no default export is reported, not thrown", async () => {
		await withDir(async (dir) => {
			await write(dir, "a.ts", extensionSource("clock"));
			const path = await write(dir, "b.ts", "export const nope = 1;\n");
			const { extensions, errors } = await loadExtensions({ dir });
			expect(extensions.map((extension) => extension.name)).toEqual(["clock"]);
			expect(errors).toHaveLength(1);
			expect(errors[0]?.file).toBe(path);
			expect(errors[0]?.reason).toMatch(/no default export/);
		});
	});

	test("a default export that is a plain plugin is reported", async () => {
		await withDir(async (dir) => {
			const path = await write(
				dir,
				"a.ts",
				[
					`import { definePlugin } from ${JSON.stringify(pluginPath)};`,
					'export default definePlugin({ name: "clock", commands: { now: () => "now" } });',
					"",
				].join("\n"),
			);
			const { extensions, errors } = await loadExtensions({ dir });
			expect(extensions).toEqual([]);
			expect(errors[0]?.file).toBe(path);
			expect(errors[0]?.reason).toMatch(/not an extension/);
		});
	});

	test("two files claiming one name are reported with both files", async () => {
		await withDir(async (dir) => {
			const first = await write(dir, "a.ts", extensionSource("clock"));
			const second = await write(dir, "b.ts", extensionSource("clock"));
			const { extensions, errors } = await loadExtensions({ dir });
			expect(extensions.map((extension) => extension.name)).toEqual(["clock"]);
			expect(errors).toHaveLength(1);
			expect(errors[0]?.file).toBe(second);
			expect(errors[0]?.reason).toContain(first);
			expect(errors[0]?.reason).toContain("clock");
		});
	});

	test("a file that throws on import is reported and the rest still load", async () => {
		await withDir(async (dir) => {
			await write(dir, "a.ts", extensionSource("clock"));
			await write(dir, "b.ts", 'throw new Error("boom");\n');
			const { extensions, errors } = await loadExtensions({ dir });
			expect(extensions.map((extension) => extension.name)).toEqual(["clock"]);
			expect(errors[0]?.reason).toContain("boom");
		});
	});

	test("names load only what the config listed, and a bare name gains its .ts", async () => {
		await withDir(async (dir) => {
			await write(dir, "a.ts", extensionSource("first"));
			await write(dir, "b.ts", extensionSource("second"));
			const { extensions, errors } = await loadExtensions({ dir, names: ["b"] });
			expect(errors).toEqual([]);
			expect(extensions.map((extension) => extension.name)).toEqual(["second"]);
		});
	});

	test("a named file that does not exist is an error, not a throw", async () => {
		await withDir(async (dir) => {
			const { extensions, errors } = await loadExtensions({ dir, names: ["missing.ts"] });
			expect(extensions).toEqual([]);
			expect(errors[0]?.file).toBe(join(dir, "missing.ts"));
			expect(errors[0]?.reason).toBe("no such file");
		});
	});

	test("an absent directory is no extensions, not an error", async () => {
		await withDir(async (dir) => {
			const { extensions, errors } = await loadExtensions({ dir: join(dir, "nope") });
			expect(extensions).toEqual([]);
			expect(errors).toEqual([]);
		});
	});
});

describe("resolveExtensionFiles", () => {
	test("discovery is the extensions directory in filename order, without tests", async () => {
		await withDir(async (dir) => {
			await write(dir, "b.ts", extensionSource("second"));
			await write(dir, "a.ts", extensionSource("first"));
			await write(dir, "a.test.ts", extensionSource("test"));
			await write(dir, "a.d.ts", "export {};\n");
			expect(await resolveExtensionFiles({ dir })).toEqual([
				join(dir, "a.ts"),
				join(dir, "b.ts"),
			]);
		});
	});

	test("the config's names resolve in its order, a bare name gaining .ts", async () => {
		await withDir(async (dir) => {
			const extensions = join(dir, "extensions");
			await mkdir(extensions, { recursive: true });
			await write(extensions, "a.ts", extensionSource("first"));
			await write(extensions, "b.ts", extensionSource("second"));

			expect(await resolveExtensionFiles({ dir: extensions, names: ["b.ts", "a"] })).toEqual([
				join(extensions, "b.ts"),
				join(extensions, "a.ts"),
			]);
			// A path written the way the config documents it lands on the same file.
			expect(
				await resolveExtensionFiles({ dir: extensions, names: ["extensions/a.ts"] }),
			).toEqual([join(extensions, "a.ts")]);
		});
	});
});
