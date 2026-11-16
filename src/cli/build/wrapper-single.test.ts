/**
 * The single-file entry's one ordering rule: the crash guard is checked before the app is imported.
 * A guard launch is the same executable re-run with a marker, so anything at module top runs a
 * second time in a process that opens no window — the emitted order is the only thing that stops it,
 * which is why both a source assertion and a real marked launch are here.
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { SingleApp } from "@/single";
import { singleWrapperSource } from "./wrapper.ts";

const transpiler = new Bun.Transpiler({ loader: "ts" });
const guardPath = fileURLToPath(new URL("../../runtime-crash-guard.ts", import.meta.url));

const app: SingleApp = {
	file: "/p/app.tsx",
	dir: "/p",
	name: "app",
	config: { app: { id: "crust.single.app", name: "app", version: "0.0.0" }, windows: [] },
};

describe("singleWrapperSource", () => {
	test("the guard check precedes every app-side import", () => {
		const source = singleWrapperSource(app, "/p/dist/crust-assets.ts", "/crust");
		const checkAt = source.indexOf("if (await runCrashGuardIfMarked()) process.exit(0);");
		expect(checkAt).toBeGreaterThan(0);

		// Static imports of the app would be evaluated before the check, so there are none.
		for (const side of ["index.ts", "runtime.ts", "single.ts"]) {
			const path = `/crust/src/${side}`;
			expect(source).not.toContain(`from ${JSON.stringify(path)};`);
			expect(source.indexOf(`await import(${JSON.stringify(path)})`)).toBeGreaterThan(
				checkAt,
			);
		}
		expect(source.indexOf('await import("/p/dist/crust-assets.ts")')).toBeGreaterThan(checkAt);
		expect(source.indexOf("registerSingleCommands(app,")).toBeGreaterThan(checkAt);
		expect(source.indexOf("await startApp({")).toBeGreaterThan(checkAt);

		// One static import, the guard's own module, and the whole entry still parses.
		expect(source.split("\n").filter((line) => line.startsWith("import "))).toEqual([
			`import { runCrashGuardIfMarked } from ${JSON.stringify("/crust/src/runtime-crash-guard.ts")};`,
		]);
		expect(() => transpiler.transformSync(source)).not.toThrow();
	});
});

/**
 * A framework tree whose every module records that it was evaluated or called, in one
 * space-separated log, so a launch that imports nothing leaves no file at all.
 */
async function fakeFramework(dir: string, log: string): Promise<string> {
	const src = join(dir, "framework", "src");
	await mkdir(src, { recursive: true });
	const to = JSON.stringify(log);
	const record = (name: string) => [
		'import { appendFileSync } from "node:fs";',
		`appendFileSync(${to}, ${JSON.stringify(name + " ")});`,
		"",
	];
	const write = (name: string, lines: string[]) => writeFile(join(src, name), lines.join("\n"));

	await write("runtime-crash-guard.ts", [
		`export { runCrashGuardIfMarked } from ${JSON.stringify(guardPath)};`,
		"",
	]);
	await write("index.ts", [
		...record("index"),
		"export const app = {",
		`\tfile: ${JSON.stringify(app.file)},`,
		`\tname: ${JSON.stringify(app.name)},`,
		`\tconfig: ${JSON.stringify(app.config)},`,
		"\tcommand() {},",
		"\ton() {},",
		`\trun: async () => { appendFileSync(${to}, ${JSON.stringify("run ")}); },`,
		"};",
		"",
	]);
	await write("single.ts", [
		...record("single"),
		`export function registerSingleCommands() { appendFileSync(${to}, ${JSON.stringify("register ")}); }`,
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
	await writeFile(
		join(dir, "crust-assets.ts"),
		[...record("assets"), "export const assets = {};", ""].join("\n"),
	);
	return join(dir, "framework");
}

/** Run the generated entry with `env`, returning its exit code. */
async function launch(entry: string, env: Record<string, string>): Promise<number> {
	const child = Bun.spawn([process.execPath, entry], {
		env: { ...process.env, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
	return await child.exited;
}

describe("a marked launch", () => {
	test("exits before the app is imported, and a normal launch still runs it", async () => {
		const dir = await mkdtemp(join(tmpdir(), "crust-single-wrapper-"));
		try {
			const log = join(dir, "side-effects.log");
			const framework = await fakeFramework(dir, log);
			const entry = join(dir, "crust-entry.ts");
			await writeFile(
				entry,
				singleWrapperSource(app, join(dir, "crust-assets.ts"), framework),
			);

			// 999999 is above this machine's pid ceiling, so the watched pid is already gone and
			// the guard finishes at once instead of polling for a live process.
			const guard = await launch(entry, {
				CRUST_CRASH_GUARD: "999999",
				CRUST_CRASH_GUARD_ROOT: join(dir, "app-data"),
			});
			expect(guard).toBe(0);
			expect(existsSync(log)).toBe(false);

			// The control: without the marker the same entry imports the app and starts it.
			expect(await launch(entry, {})).toBe(0);
			expect((await readFile(log, "utf8")).trim().split(" ")).toEqual([
				"index",
				"assets",
				"runtime",
				"single",
				"register",
				"start",
				"run",
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}, 20_000);
});
