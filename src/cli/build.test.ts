import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CrustConfig } from "@/config";
import { assetsModuleSource, resolveAssets } from "./build.ts";

/**
 * `beforeBuildCommand` and `build.assets`, tested without compiling a bundle:
 * `resolveAssets` is the seam `crust build` uses between running the frontend
 * build and writing the asset module, so a test here is the same decision the
 * real command makes. Everything is offline and a few shell calls at most.
 */

const roots: string[] = [];

async function project(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "crust-cli-build-"));
	roots.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function config(build: CrustConfig["build"]): CrustConfig {
	return {
		app: { id: "dev.crust.test", name: "Test", version: "0.1.0" },
		windows: [{ label: "main" }],
		build,
	};
}

describe("resolveAssets", () => {
	test("a failed beforeBuildCommand aborts, naming the command and its code", async () => {
		const dir = await project();
		const outcome = await resolveAssets(
			dir,
			config({ assets: "web", beforeBuildCommand: "exit 7" }),
			resolve(dir, "dist"),
		);

		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.failure).toContain("beforeBuildCommand");
		expect(outcome.failure).toContain("exit 7");
		expect(outcome.failure).toContain("exited with 7");
		expect(outcome.failure).toContain("nothing was packaged");
	});

	test("the file a beforeBuildCommand writes is the file that gets embedded", async () => {
		const dir = await project();
		const outcome = await resolveAssets(
			dir,
			config({
				assets: "web",
				beforeBuildCommand:
					"mkdir -p web && printf '%s' '<p>built fresh</p>' > web/index.html",
			}),
			resolve(dir, "dist"),
		);

		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		expect(outcome.label).toBe("web");
		expect(outcome.files.map((file) => file.path)).toEqual(["/index.html"]);
		expect(outcome.files[0]?.text).toBe(true);
		expect(assetsModuleSource(outcome.files)).toContain("built fresh");
	});

	test("a command that exits 0 but produces nothing says so, and names the directory", async () => {
		const dir = await project();
		const outcome = await resolveAssets(
			dir,
			config({ assets: "web", beforeBuildCommand: "true" }),
			resolve(dir, "dist"),
		);

		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.failure).toContain("produced nothing");
		expect(outcome.failure).toContain(resolve(dir, "web"));
	});

	test("without a command, a missing directory says the frontend was not built", async () => {
		const dir = await project();
		const outcome = await resolveAssets(
			dir,
			config({ assets: "dist/web" }),
			resolve(dir, "dist"),
		);

		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.failure).toContain("has not been built yet");
		expect(outcome.failure).toContain(resolve(dir, "dist/web"));
	});

	test("build.assets may not point at crust build's own output directory", async () => {
		const dir = await project();
		const outcome = await resolveAssets(dir, config({ assets: "dist" }), resolve(dir, "dist"));

		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.failure).toContain("crust build writes its own output");
	});

	test("an absent build.assets keeps the public/ behaviour", async () => {
		const dir = await project();
		const outcome = await resolveAssets(dir, config(undefined), resolve(dir, "dist"));

		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		expect(outcome.label).toBe("public");
		expect(outcome.files).toEqual([]);
	});
});

describe("crust build", () => {
	test("exits 1 with the failing command's name and code, and packages nothing", async () => {
		const dir = await project();
		await writeFile(
			join(dir, "crust.config.ts"),
			`export default {
	app: { id: "dev.crust.test", name: "Test", version: "0.1.0" },
	windows: [{ label: "main" }],
	build: { assets: "web", beforeBuildCommand: "exit 7" },
};
`,
			"utf8",
		);
		await writeFile(join(dir, "main.ts"), 'import { app } from "crust";\nawait app.run();\n');

		const child = Bun.spawn({
			cmd: [
				process.execPath,
				"run",
				join(import.meta.dir, "index.ts"),
				"build",
				"--dir",
				dir,
			],
			cwd: dir,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);

		expect(code).toBe(1);
		expect(stdout).toContain("before");
		expect(stdout).toContain("exit 7");
		expect(stderr).toContain("crust build:");
		expect(stderr).toContain("exited with 7");
		expect(await stat(join(dir, "dist")).catch(() => undefined)).toBeUndefined();
	});
});
