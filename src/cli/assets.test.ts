import { describe, expect, test } from "bun:test";

import { isEmbedded, listAssets, readAsset } from "@/cli/assets";

describe("listAssets", () => {
	test("lists a template from disk with forward-slash relative paths", async () => {
		const assets = await listAssets("templates/next");
		const names = assets.map((asset) => asset.relative);
		expect(names).toEqual([
			"app/layout.tsx",
			"app/page.tsx",
			"crust.config.ts",
			"gitignore",
			"main.ts",
			"next.config.mjs",
			"package.json",
			"tsconfig.json",
		]);
	});

	test("returns bytes that are the file on disk", async () => {
		const assets = await listAssets("templates/default");
		const main = assets.find((asset) => asset.relative === "main.ts");
		expect(main).toBeDefined();
		const bytes = await main?.bytes();
		expect(new TextDecoder().decode(bytes).length).toBeGreaterThan(0);
	});

	test("rejects for a directory that is neither on disk nor embedded", async () => {
		await expect(listAssets("templates/does-not-exist")).rejects.toThrow();
	});
});

describe("readAsset", () => {
	test("reads one file by its crust-root-relative path", async () => {
		const bytes = await readAsset("templates/react/index.html");
		expect(bytes).toBeDefined();
		expect(new TextDecoder().decode(bytes)).toContain('<div id="root"');
	});

	test("returns undefined instead of throwing when nothing has it", async () => {
		expect(await readAsset("templates/nope/nothing.ts")).toBeUndefined();
	});
});

describe("isEmbedded", () => {
	test("is false in a normal run, where assets come from disk", () => {
		// A test process is not a compiled executable, so nothing is embedded.
		// The compiled path is proved by `bun build --compile --asset` in CI terms:
		// see the standalone-binary note in docs/publishing.md.
		expect(isEmbedded("templates/react/main.ts")).toBe(false);
	});
});
