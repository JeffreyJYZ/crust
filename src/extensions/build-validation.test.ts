/**
 * The HIGH row's closing test: the real `crust build` command, not the validator in isolation.
 * A project whose extension has no default export must exit non-zero and print the file and reason;
 * a project with a valid extension must still build and embed only that file.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const definePath = fileURLToPath(new URL("./define.ts", import.meta.url));
const cli = fileURLToPath(new URL("../cli/index.ts", import.meta.url));
const roots: string[] = [];

async function project(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "crust-build-extensions-"));
	roots.push(dir);
	await mkdir(join(dir, "extensions"), { recursive: true });
	await writeFile(
		join(dir, "crust.config.ts"),
		[
			"export default {",
			'  app: { id: "dev.crust.test", name: "Test", version: "0.1.0" },',
			'  windows: [{ label: "main" }],',
			"};",
			"",
		].join("\n"),
		"utf8",
	);
	await writeFile(join(dir, "main.ts"), "export const ready = true;\n", "utf8");
	return dir;
}

async function build(dir: string): Promise<{ code: number; out: string; err: string }> {
	const child = Bun.spawn({
		cmd: [process.execPath, "run", cli, "build", "--dir", dir],
		cwd: dir,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { code, out, err };
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("crust build validates embedded extensions", () => {
	test("a default-less extension fails the build, naming the file and the reason", async () => {
		const dir = await project();
		const bad = join(dir, "extensions", "broken.ts");
		await writeFile(bad, "export const nope = 1;\n", "utf8");

		const result = await build(dir);
		expect(result.code).toBe(1);
		expect(result.err).toContain("crust build:");
		expect(result.err).toContain(bad);
		expect(result.err).toContain("no default export");
		// Refused before the wrapper is written: nothing embeds the broken file.
		expect(
			await stat(join(dir, "dist", "crust-entry.ts")).catch(() => undefined),
		).toBeUndefined();
	}, 120_000);

	test("a valid extension still builds, and only that file is embedded", async () => {
		const dir = await project();
		const good = join(dir, "extensions", "clock.ts");
		await writeFile(
			good,
			[
				`import { defineExtension } from ${JSON.stringify(definePath)};`,
				'export default defineExtension({ name: "clock", commands: { now: () => 1 } });',
				"",
			].join("\n"),
			"utf8",
		);

		const result = await build(dir);
		expect(result.code).toBe(0);
		expect(result.out).toContain("1 file embedded");
		const wrapper = await readFile(join(dir, "dist", "crust-entry.ts"), "utf8");
		expect(wrapper).toContain(JSON.stringify(good));
		expect(wrapper).not.toContain("broken.ts");
	}, 120_000);
});
