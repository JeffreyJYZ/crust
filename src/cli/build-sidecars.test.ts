import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SIDECAR_MANIFEST } from "@/plugins/sidecar";

/**
 * The defect: build.sidecars was validated and documented but never passed to buildApp, so
 * `copySidecars` wrote `[]` and copied nothing. This runs the real CLI build into a temp dir
 * and reads the manifest the app actually ships — the wiring, not just the config validator.
 */

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("crust build wires build.sidecars into the app", () => {
	test("a built app's manifest names the declared sidecar and ships the binary", async () => {
		const dir = await mkdtemp(join(tmpdir(), "crust-sidecars-"));
		roots.push(dir);
		await mkdir(join(dir, "bin"), { recursive: true });
		await writeFile(join(dir, "bin", "tool.sh"), "#!/bin/sh\necho sidecar\n", {
			mode: 0o644,
		});
		// A no-op entry keeps the compile offline: no `crust` import to resolve from the temp tree.
		await writeFile(join(dir, "main.ts"), "export default 1;\n", "utf8");
		await writeFile(
			join(dir, "crust.config.ts"),
			`export default {
	app: { id: "dev.crust.sidecar", name: "SidecarTest", version: "0.1.0" },
	windows: [{ label: "main" }],
	build: { sidecars: ["bin/tool.sh"] },
};
`,
			"utf8",
		);

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
		expect(code, `${stdout}\n${stderr}`).toBe(0);

		const macos = join(dir, "dist", "SidecarTest.app", "Contents", "MacOS");
		const manifestDir =
			process.platform === "darwin"
				? join(dir, "dist", "SidecarTest.app", "Contents", "Resources")
				: macos;
		const manifest = JSON.parse(await readFile(join(manifestDir, SIDECAR_MANIFEST), "utf8"));
		expect(manifest).toEqual(["bin/tool.sh"]);
		const shipped = join(macos, "bin", "tool.sh");
		expect((await stat(shipped)).isFile()).toBe(true);
		expect((await stat(shipped)).mode & 0o777).toBe(0o755);
	}, 120_000);
});
