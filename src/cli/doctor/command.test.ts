/**
 * `crust doctor` end to end: the command a user runs, and the exit code and
 * lines it prints for each shape of project.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { project, runDoctor } from "./fixtures.ts";

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
