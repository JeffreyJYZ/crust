import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CrustConfig } from "@/config";
import { checkAssets, checkTemplates, preferredPort } from "./doctor.ts";
import { crustRoot } from "./util.ts";

/**
 * `crust doctor` decides from the same files `crust dev` and `crust build`
 * read, so these tests are the decisions themselves: what `build.assets`
 * resolves to, whether a configless directory is a single-file app, and the
 * port the bridge binds. Nothing here compiles a bundle except the end-to-end
 * runs of the command, which is what the user runs.
 */

const roots: string[] = [];

async function project(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "crust-cli-doctor-"));
	roots.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function config(build?: CrustConfig["build"]): CrustConfig {
	return {
		app: { id: "dev.crust.doctor", name: "Test", version: "0.1.0" },
		windows: [{ label: "main" }],
		build,
	};
}

async function page(dir: string, file = "index.html"): Promise<void> {
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, file), "<!doctype html><p>hi</p>", "utf8");
}

interface Run {
	stdout: string;
	stderr: string;
	code: number;
}

async function runDoctor(dir: string, ...args: string[]): Promise<Run> {
	const child = Bun.spawn({
		cmd: [
			process.execPath,
			"run",
			join(import.meta.dir, "index.ts"),
			"doctor",
			"--dir",
			dir,
			...args,
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
	return { stdout, stderr, code };
}

describe("preferredPort", () => {
	test("is stable, in the runtime's range, and differs between ids", () => {
		const hello = preferredPort("land.jyz.hello");
		expect(hello).toBe(preferredPort("land.jyz.hello"));
		expect(hello).toBeGreaterThanOrEqual(45000);
		expect(hello).toBeLessThan(49000);
		expect(preferredPort("land.jyz.notes")).not.toBe(hello);
	});

	test("matches the port the real runtime binds for the same id", async () => {
		const id = "dev.crust.doctor-port-probe";
		const script = [
			'import { startApp } from "./src/runtime.ts";',
			"const id = process.env.CRUST_DOCTOR_PROBE_ID;",
			"const handle = await startApp({",
			'\tconfig: { app: { id, name: "doctor probe", version: "0.0.0" }, windows: [{ label: "main" }] },',
			"\tattachPlatform: false,",
			"\tassets: {},",
			'\troot: "/nonexistent-crust-doctor-root",',
			"\tentryModule: async () => {},",
			"});",
			'console.log("CRUST_DOCTOR_PORT=" + handle.port);',
			"await handle.stop();",
			"process.exit(0);",
		].join("\n");
		const child = Bun.spawn({
			cmd: [process.execPath, "-e", script],
			cwd: crustRoot,
			env: { ...process.env, CRUST_DOCTOR_PROBE_ID: id },
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, byRuntime, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect(byRuntime).toBe("");
		expect(code).toBe(0);
		const match = /CRUST_DOCTOR_PORT=(\d+)/.exec(stdout);
		expect(match?.[1]).toBeDefined();
		expect(Number(match?.[1])).toBe(preferredPort(id));
	});
});

describe("checkAssets", () => {
	test("a named directory that does not exist fails with its path and the build to run", async () => {
		const dir = await project();
		const outcome = await checkAssets(dir, config({ assets: "dist/web" }));

		expect(outcome.status).toBe("fail");
		expect(outcome.detail).toContain("build.assets");
		expect(outcome.detail).toContain(resolve(dir, "dist/web"));
		expect(outcome.detail).toContain("bun x vite build");
		expect(outcome.detail).toContain("crust build");
	});

	test("a named directory without index.html fails even though it exists", async () => {
		const dir = await project();
		await page(join(dir, "web"), "app.js");
		const outcome = await checkAssets(dir, config({ assets: "web" }));

		expect(outcome.status).toBe("fail");
		expect(outcome.detail).toContain("no index.html");
		expect(outcome.detail).toContain(resolve(dir, "web"));
	});

	test("a named directory with index.html passes, and says the command was not run", async () => {
		const dir = await project();
		await page(join(dir, "web"));
		const outcome = await checkAssets(
			dir,
			config({ assets: "web", beforeBuildCommand: "bun x vite build" }),
		);

		expect(outcome.status).toBe("ok");
		expect(outcome.detail).toContain(resolve(dir, "web"));
		expect(outcome.detail).toContain("not run by doctor");
	});

	test("build.assets at crust's own output directory is refused", async () => {
		const dir = await project();
		const outcome = await checkAssets(dir, config({ assets: "dist" }));

		expect(outcome.status).toBe("fail");
		expect(outcome.detail).toContain("writes its own output");
	});

	test("an absent setting keeps the public/ rule", async () => {
		const dir = await project();
		await page(join(dir, "public"));
		const outcome = await checkAssets(dir, config());

		expect(outcome.status).toBe("ok");
		expect(outcome.detail).toContain(resolve(dir, "public"));
	});

	test("beforeBuildCommand with no build.assets and no public page would embed nothing", async () => {
		const dir = await project();
		const outcome = await checkAssets(dir, config({ beforeBuildCommand: "bun x vite build" }));

		expect(outcome.status).toBe("fail");
		expect(outcome.detail).toContain("build.assets");
		expect(outcome.detail).toContain("would embed nothing");
	});

	test("no frontend at all is a note, not a failure", async () => {
		const dir = await project();
		const outcome = await checkAssets(dir, config());

		expect(outcome.status).toBe("note");
		expect(outcome.detail).toContain("no page");
	});
});

describe("checkTemplates", () => {
	test("names every missing scaffold and the install it came from", async () => {
		const root = await project();
		await page(join(root, "templates", "default"), "index.html");
		const outcome = await checkTemplates(root);

		expect(outcome.status).toBe("fail");
		expect(outcome.detail).toContain("templates/react");
		expect(outcome.detail).toContain("templates/next");
		expect(outcome.detail).toContain("reinstall crust");
	});

	test("passes when all three scaffolds are present", async () => {
		const root = await project();
		for (const name of ["default", "react", "next"]) {
			await page(join(root, "templates", name), "package.json");
		}
		const outcome = await checkTemplates(root);

		expect(outcome.status).toBe("ok");
		expect(outcome.detail).toContain("default, react, next");
	});
});

describe("crust doctor", () => {
	test("a broken config exits 1 and names the offending key", async () => {
		const dir = await project();
		await writeFile(
			join(dir, "crust.config.ts"),
			`export default {
	app: { id: "dev.crust.test", name: "Test", version: "0.1.0" },
	windows: [{}],
};
`,
			"utf8",
		);
		await writeFile(join(dir, "main.ts"), "await app.run();\n");

		const run = await runDoctor(dir);

		expect(run.code).toBe(1);
		expect(run.stdout).toContain("[fail]");
		expect(run.stdout).toContain("windows[0].label");
		expect(run.stdout).toContain("fix the key named above");
		expect(run.stderr).toContain("1 check failed");
	});

	test("a missing build.assets directory exits 1 naming the path", async () => {
		const dir = await project();
		await writeFile(
			join(dir, "crust.config.ts"),
			`export default {
	app: { id: "dev.crust.test", name: "Test", version: "0.1.0" },
	windows: [{ label: "main" }],
	build: { assets: "dist/web" },
};
`,
			"utf8",
		);
		await writeFile(join(dir, "main.ts"), "await app.run();\n");

		const run = await runDoctor(dir);

		expect(run.code).toBe(1);
		expect(run.stdout).toContain("assets");
		expect(run.stdout).toContain("[fail]");
		expect(run.stdout).toContain(resolve(dir, "dist/web"));
		expect(run.stdout).toContain("run the frontend build");
	});

	test("a configless single file is an app, not a config failure", async () => {
		const dir = await project();
		await writeFile(join(dir, "app.tsx"), 'document.body.textContent = "hi";\n', "utf8");

		const run = await runDoctor(dir);

		expect(run.code).toBe(0);
		expect(run.stdout).toContain("single");
		expect(run.stdout).toContain("[ok]");
		expect(run.stdout).toContain("the same build crust dev runs");
		expect(run.stdout).toContain("no backend module");
		expect(run.stdout).not.toContain("config    [fail]");
		expect(run.stdout).toContain("all checks passed");
	});

	test("a single file that does not bundle exits 1 with the compiler's error", async () => {
		const dir = await project();
		await writeFile(
			join(dir, "app.tsx"),
			"export default function App() {\n\treturn <p>hi</p>;\n}\n",
			"utf8",
		);

		const run = await runDoctor(dir);

		expect(run.code).toBe(1);
		expect(run.stdout).toContain("does not bundle");
		expect(run.stdout).toContain("react and react-dom are not installed");
	});

	test("without a config and without an app, the failure says what is missing", async () => {
		const dir = await project();
		await writeFile(join(dir, "notes.txt"), "hello\n", "utf8");

		const run = await runDoctor(dir);

		expect(run.code).toBe(1);
		expect(run.stdout).toContain("no crust config");
		expect(run.stdout).toContain("crust init");
		expect(run.stdout).toContain("not checked: no valid config");
	});
});
