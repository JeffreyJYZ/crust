/**
 * What a build would embed and whether the scaffolds are installed: the two
 * decisions that explain a blank window and a broken `crust init`.
 */

import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { checkAssets, checkTemplates } from "../doctor.ts";
import { config, page, project } from "./fixtures.ts";

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
