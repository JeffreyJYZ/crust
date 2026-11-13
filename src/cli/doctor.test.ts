import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { CrustConfig } from "@/config";
import {
	checkAssets,
	checkTemplates,
	classifyDevPort,
	devUrlTarget,
	pageSideTypeScript,
	preferredPort,
	watcherNote,
} from "./doctor.ts";
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

describe("devUrlTarget", () => {
	test("reads the port a loopback url names, and the protocol default", () => {
		expect(devUrlTarget("http://localhost:5173")).toEqual({
			hostname: "localhost",
			port: 5173,
		});
		expect(devUrlTarget("http://127.0.0.1:3000/")).toEqual({
			hostname: "127.0.0.1",
			port: 3000,
		});
		expect(devUrlTarget("https://localhost")).toEqual({ hostname: "localhost", port: 443 });
	});

	test("tells a remote host and an unreadable string apart", () => {
		expect(devUrlTarget("http://example.com:5173")).toBe("remote");
		expect(devUrlTarget("nonsense")).toBe("unreadable");
	});
});

describe("classifyDevPort", () => {
	const base = { url: "http://localhost:5173", port: 5173 };

	test("a free port is ok and names it", () => {
		const check = classifyDevPort({ ...base, listening: false, answered: false });

		expect(check.name).toBe("dev port");
		expect(check.status).toBe("ok");
		expect(check.detail).toContain("port 5173 is free");
		expect(check.detail).toContain(base.url);
	});

	test("a port held by the dev server already answering is a note, not a fail", () => {
		const check = classifyDevPort({
			...base,
			listening: true,
			answered: true,
			holder: 4242,
		});

		expect(check.status).toBe("note");
		expect(check.detail).toContain("held by pid 4242");
		expect(check.detail).toContain("already answers");
		expect(check.detail).toContain("change dev.url");
	});

	test("a holder that answers nothing on that url is fatal, naming the next step", () => {
		const check = classifyDevPort({ ...base, listening: true, answered: false, holder: 77 });

		expect(check.status).toBe("fail");
		expect(check.detail).toContain("pid 77");
		expect(check.detail).toContain("does not answer");
		expect(check.detail).toContain("strictPort");
		expect(check.detail).toContain("free the port or change dev.url");
	});

	test("a pid lsof cannot read still names the port and the holder", () => {
		const check = classifyDevPort({ ...base, listening: true, answered: true });

		expect(check.status).toBe("note");
		expect(check.detail).toContain("lsof cannot read");
	});

	test("an answering url with nothing on the port is a proxy or a remote host", () => {
		const check = classifyDevPort({ ...base, listening: false, answered: true });

		expect(check.status).toBe("note");
		expect(check.detail).toContain("nothing is listening");
	});
});

describe("pageSideTypeScript", () => {
	test("finds page-side .ts and skips the entry, config, tests, declarations and watched-out dirs", async () => {
		const dir = await project();
		const files: Record<string, string> = {
			"src/App.tsx": "export default 1;\n",
			"src/bridge.ts": "export const bridge = 1;\n",
			"src/notes.ts": "export const notes = 1;\n",
			"src/notes.test.ts": "// test\n",
			"src/types.d.ts": "declare const x: number;\n",
			"desktop/main.ts": "// entry\n",
			"crust.config.ts": "export default {};\n",
			"vite.config.ts": "export default {};\n",
			"public/handwritten.ts": "export const x = 1;\n",
			"node_modules/dep/index.ts": "export const y = 1;\n",
			"dist/bundled.ts": "export const z = 1;\n",
		};
		for (const [path, text] of Object.entries(files)) {
			await mkdir(dirname(join(dir, path)), { recursive: true });
			await writeFile(join(dir, path), text, "utf8");
		}

		expect(await pageSideTypeScript(dir, join(dir, "desktop/main.ts"))).toEqual([
			"src/bridge.ts",
			"src/notes.ts",
		]);
	});

	test("without an entry, a .ts module at the project root is reported too", async () => {
		const dir = await project();
		await mkdir(join(dir, "src"), { recursive: true });
		await writeFile(join(dir, "src", "bridge.ts"), "export const bridge = 1;\n", "utf8");
		await writeFile(join(dir, "main.ts"), "// entry\n", "utf8");

		expect(await pageSideTypeScript(dir)).toEqual(["main.ts", "src/bridge.ts"]);
	});

	test("a dev-server layout with no page-side .ts reports nothing", async () => {
		const dir = await project();
		await mkdir(join(dir, "src"), { recursive: true });
		await writeFile(join(dir, "src", "App.tsx"), "export default 1;\n", "utf8");
		await writeFile(join(dir, "src", "main.ts"), "// entry\n", "utf8");

		expect(await pageSideTypeScript(dir, join(dir, "src", "main.ts"))).toEqual([]);
	});
});

describe("watcherNote", () => {
	test("is a note with a count and the first three names, and says how to fix it", () => {
		const check = watcherNote(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]);

		expect(check.name).toBe("dev watch");
		expect(check.status).toBe("note");
		expect(check.detail).toContain("4 page-side .ts files");
		expect(check.detail).toContain("src/a.ts, src/b.ts, src/c.ts, +1 more");
		expect(check.detail).toContain("rename them .tsx");
		expect(check.detail).toContain("public/");
	});

	test("singular for one file", () => {
		expect(watcherNote(["src/bridge.ts"]).detail).toContain(
			"1 page-side .ts file (src/bridge.ts)",
		);
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

	test("a dev-server project with page-side .ts gets the port and watcher lines", async () => {
		const dir = await project();
		await writeFile(
			join(dir, "crust.config.ts"),
			`export default {
	app: { id: "dev.crust.test", name: "Test", version: "0.1.0" },
	dev: { url: "http://127.0.0.1:9" },
	windows: [{ label: "main" }],
};
`,
			"utf8",
		);
		await mkdir(join(dir, "src"), { recursive: true });
		await writeFile(join(dir, "main.ts"), "await app.run();\n", "utf8");
		await writeFile(join(dir, "src", "bridge.ts"), "export const bridge = 1;\n", "utf8");

		const run = await runDoctor(dir);

		// `dev url` fails because nothing is serving the port, but neither new
		// check does: a free port and a watcher note are both notes/ok.
		expect(run.stdout).toContain("dev port");
		expect(run.stdout).toContain("dev watch");
		expect(run.stdout).toContain("src/bridge.ts");
		expect(run.stdout).toContain("[note]");
	});

	test("without dev.url neither the port nor the watcher line appears", async () => {
		const dir = await project();
		await writeFile(
			join(dir, "crust.config.ts"),
			`export default {
	app: { id: "dev.crust.test", name: "Test", version: "0.1.0" },
	windows: [{ label: "main" }],
};
`,
			"utf8",
		);
		await mkdir(join(dir, "src"), { recursive: true });
		await mkdir(join(dir, "public"), { recursive: true });
		await writeFile(join(dir, "main.ts"), "await app.run();\n", "utf8");
		await writeFile(join(dir, "src", "bridge.ts"), "export const bridge = 1;\n", "utf8");
		await writeFile(join(dir, "public", "index.html"), "<p>hi</p>\n", "utf8");

		const run = await runDoctor(dir);

		expect(run.code).toBe(0);
		expect(run.stdout).not.toContain("dev port");
		expect(run.stdout).not.toContain("dev watch");
	});
});
