import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SIDECAR_MANIFEST } from "@/plugins/sidecar";
import type { SingleApp } from "@/single";
import { buildSingle } from "./single-app";

/** The defect: single-file builds omitted F4's sidecar wiring, so a built app named no sidecars. */
const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("buildSingle sidecars", () => {
	test("a single-file app's manifest names the declared sidecar and ships the binary", async () => {
		const dir = await mkdtemp(join(tmpdir(), "crust-single-sidecar-"));
		roots.push(dir);
		await mkdir(join(dir, "bin"), { recursive: true });
		await writeFile(join(dir, "bin", "tool.sh"), "#!/bin/sh\necho sidecar\n", { mode: 0o644 });
		// An .html page skips the bundler, so this test only pays for the compile and sign.
		await writeFile(join(dir, "page.html"), "<html><body>page</body></html>", "utf8");
		const app: SingleApp = {
			file: join(dir, "page.html"),
			dir,
			name: "page",
			config: {
				app: { id: "dev.crust.singleSidecar", name: "SingleSidecar", version: "0.1.0" },
				windows: [{ label: "main", url: "/", width: 900, height: 700 }],
				build: { sidecars: ["bin/tool.sh"] },
			},
		};

		expect(await buildSingle(app, "13.0")).toBe(0);

		const macos = join(dir, "dist", "SingleSidecar.app", "Contents", "MacOS");
		const manifestDir =
			process.platform === "darwin"
				? join(dir, "dist", "SingleSidecar.app", "Contents", "Resources")
				: join(dir, "dist");
		expect(JSON.parse(await readFile(join(manifestDir, SIDECAR_MANIFEST), "utf8"))).toEqual([
			"bin/tool.sh",
		]);
		const shipped = join(macos, "bin", "tool.sh");
		expect((await stat(shipped)).isFile()).toBe(true);
		expect((await stat(shipped)).mode & 0o777).toBe(0o755);
	}, 120_000);
});
