import { describe, expect, test } from "bun:test";

import { isFrontendSource, isIgnoredWatchPath } from "@/cli/ignore";

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

describe("isFrontendSource", () => {
	test("claims the files a dev server reloads", () => {
		for (const path of [
			"src/main.tsx",
			"src/App.tsx",
			"src/styles.css",
			"index.html",
			"public/icon.svg",
			"assets/logo.png",
			"fonts/satoshi.woff2",
		])
			expect({ path, frontend: isFrontendSource(path) }).toEqual({ path, frontend: true });
	});

	test("never claims the backend entry or a command file", () => {
		// `.ts` and `.js` are absent on purpose: `main.ts` is the backend entry, and a
		// restart there is correct.
		for (const path of [
			"main.ts",
			"src/main.ts",
			"src/commands/notes.ts",
			"lib/x.js",
			"crust.config.ts",
		])
			expect({ path, frontend: isFrontendSource(path) }).toEqual({ path, frontend: false });
	});

	test("treats a missing filename as not frontend", () => {
		expect(isFrontendSource(null)).toBe(false);
		expect(isFrontendSource(undefined)).toBe(false);
	});
});
