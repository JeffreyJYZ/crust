/**
 * The multi-file entry's one ordering rule: the crash guard is checked before the config, the asset
 * table, the runtime, the registry or any extension is imported. A guard launch is the same
 * executable re-run with a marker, so the emitted order is the only thing that keeps a second copy
 * of the app's module-level work out of a process that opens no window — pinned here as source and
 * as two real launches, one marked and one not.
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { wrapperSource } from "./wrapper.ts";

const guardPath = fileURLToPath(new URL("../../runtime-crash-guard.ts", import.meta.url));
const transpiler = new Bun.Transpiler({ loader: "ts" });

const base = {
	configPath: "/p/crust.config.ts",
	entryPath: "/p/main.ts",
	assetsPath: "/p/dist/crust-assets.ts",
	runtimePath: "/crust/src/runtime.ts",
	extensionsPath: "/crust/src/extensions/registry.ts",
	projectDir: "/p",
	extensionFiles: ["extensions/clock.ts"],
};

describe("wrapperSource guard ordering", () => {
	test("the check precedes the config, the assets, the runtime and the registry", () => {
		const source = wrapperSource(base);
		const checkAt = source.indexOf("if (await runCrashGuardIfMarked()) process.exit(0);");
		expect(checkAt).toBeGreaterThan(0);

		for (const path of [
			base.configPath,
			base.assetsPath,
			base.runtimePath,
			base.extensionsPath,
			"/p/extensions/clock.ts",
		]) {
			expect(source).not.toContain(`from ${JSON.stringify(path)};`);
			expect(source.indexOf(`await import(${JSON.stringify(path)})`)).toBeGreaterThan(
				checkAt,
			);
		}

		// The guard is the only static import, and the whole entry still parses.
		expect(source.split("\n").filter((line) => line.startsWith("import "))).toEqual([
			`import { runCrashGuardIfMarked } from ${JSON.stringify("/crust/src/runtime-crash-guard.ts")};`,
		]);
		expect(() => transpiler.transformSync(source)).not.toThrow();
	});
});

/** A project tree where every module records that it was evaluated or called. */
async function fakeProject(dir: string, log: string): Promise<void> {
	const to = JSON.stringify(log);
	const record = (name: string) => [
		'import { appendFileSync } from "node:fs";',
		`appendFileSync(${to}, ${JSON.stringify(name + " ")});`,
		"",
	];
	const write = (name: string, lines: string[]) => writeFile(join(dir, name), lines.join("\n"));

	await mkdir(join(dir, "extensions"), { recursive: true });
	await write("crust.config.ts", [
		...record("config"),
		"export default { app: {}, windows: [] };",
		"",
	]);
	await write("crust-assets.ts", [...record("assets"), "export const assets = {};", ""]);
	await write("main.ts", record("main"));
	await write("runtime-crash-guard.ts", [
		`export { runCrashGuardIfMarked } from ${JSON.stringify(guardPath)};`,
		"",
	]);
	await write("registry.ts", [
		...record("registry"),
		"export function extensionRegistry() {",
		`\tappendFileSync(${to}, ${JSON.stringify("factory ")});`,
		"\treturn {",
		`\t\tregister: (...plugins: { name: string }[]) => appendFileSync(${to}, "register:" + plugins.map((plugin) => plugin.name).join(",") + " "),`,
		"\t};",
		"}",
		"",
	]);
	await write("runtime.ts", [
		...record("runtime"),
		"export async function startApp(options: { entryModule: () => Promise<void> }) {",
		`\tappendFileSync(${to}, ${JSON.stringify("start ")});`,
		"\tawait options.entryModule();",
		"}",
		"",
	]);
	await write("extensions/clock.ts", [
		...record("extension"),
		'export default { name: "clock", commands: {} };',
		"",
	]);
}

/** Run a generated entry with `env`, returning its exit code. */
async function launch(entry: string, env: Record<string, string> = {}): Promise<number> {
	const child = Bun.spawn([process.execPath, entry], {
		env: { ...process.env, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
	return await child.exited;
}

describe("a multi-file build's launches", () => {
	test("a marked launch loads nothing, and a normal one loads the app once", async () => {
		const dir = await mkdtemp(join(tmpdir(), "crust-wrapper-guard-"));
		try {
			const log = join(dir, "side-effects.log");
			await fakeProject(dir, log);
			const entry = join(dir, "crust-entry.ts");
			await writeFile(
				entry,
				wrapperSource({
					configPath: join(dir, "crust.config.ts"),
					entryPath: join(dir, "main.ts"),
					assetsPath: join(dir, "crust-assets.ts"),
					runtimePath: join(dir, "runtime.ts"),
					extensionsPath: join(dir, "registry.ts"),
					projectDir: dir,
					extensionFiles: ["extensions/clock.ts"],
				}),
			);

			// 999999 is above this machine's pid ceiling, so the watched pid is already gone and
			// the guard finishes at once instead of polling for a live process.
			expect(
				await launch(entry, {
					CRUST_CRASH_GUARD: "999999",
					CRUST_CRASH_GUARD_ROOT: join(dir, "app-data"),
				}),
			).toBe(0);
			expect(existsSync(log)).toBe(false);

			// The control: without the marker the same entry loads and registers everything once.
			expect(await launch(entry)).toBe(0);
			expect((await readFile(log, "utf8")).trim().split(" ")).toEqual([
				"config",
				"assets",
				"runtime",
				"registry",
				"factory",
				"extension",
				"register:clock",
				"start",
				"main",
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}, 20_000);
});
