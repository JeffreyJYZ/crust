import { describe, expect, test } from "bun:test";

import { isIgnoredWatchPath } from "@/cli/ignore";

describe("isIgnoredWatchPath", () => {
	test("ignores each frontend and build-output directory", () => {
		for (const path of [
			".next/server/app/page.js",
			"app/.next/trace",
			"out/index.html",
			"public/index.html",
			"dist/crust-app",
			"node_modules/react/index.js",
			".crust/dev.json",
		])
			expect({ path, ignored: isIgnoredWatchPath(path) }).toEqual({ path, ignored: true });
	});

	test("ignores them on Windows separators too", () => {
		expect(isIgnoredWatchPath("app\\.next\\trace")).toBe(true);
		expect(isIgnoredWatchPath("src\\main.ts")).toBe(false);
	});

	test("keeps backend code, including a file that merely looks similar", () => {
		for (const path of [
			"main.ts",
			"src/commands/notes.ts",
			"app/page.tsx",
			"convex/main.ts",
			"output.ts",
			"publicity/main.ts",
			"distribution/main.ts",
			".next.config.ts",
		])
			expect({ path, ignored: isIgnoredWatchPath(path) }).toEqual({ path, ignored: false });
	});

	test("treats a missing filename as not ignored", () => {
		expect(isIgnoredWatchPath(null)).toBe(false);
		expect(isIgnoredWatchPath(undefined)).toBe(false);
		expect(isIgnoredWatchPath("")).toBe(false);
	});
});
