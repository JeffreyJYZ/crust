/**
 * A regex above `export default` used to be read as source: quotes inside a character class opened
 * a string, and `//` inside the regex opened a comment, so the page bundled with no mount and opened
 * blank. Both shapes are measured regressions from hunt-21/18.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectSingle } from "@/single-detect.ts";
import { buildPage } from "@/single-build.ts";
import { hasDefaultExport, PAGE_ENTRY } from "@/single-page.ts";

describe("a regex literal before a default export", () => {
	test("a character class with both quote kinds does not hide the export", () => {
		expect(hasDefaultExport("const q = /[\"']/;\nexport default function P() {}\n")).toBe(true);
	});

	test("an escaped // inside a regex does not comment out the export", () => {
		expect(
			hasDefaultExport("const re = /https?:\\/\\//; export default function P() {}\n"),
		).toBe(true);
	});

	test("a regex after a division still leaves a real export visible", () => {
		expect(hasDefaultExport("const x = a / b; const re = /[/]/; export default x;\n")).toBe(
			true,
		);
	});

	test("fake exports in comments and strings stay hidden", () => {
		expect(hasDefaultExport("/* export default X */\n")).toBe(false);
		expect(hasDefaultExport("const s = 'export default X';\n")).toBe(false);
		expect(hasDefaultExport("document.body.textContent = `\nexport default X\n`;\n")).toBe(
			false,
		);
	});

	test("a built page mounts the component when a regex precedes the export", async () => {
		const dir = await mkdtemp(join(tmpdir(), "crust-single-regex-"));
		try {
			await writeFile(
				join(dir, "app.tsx"),
				"const q = /[\"']/;\nexport default function P() { return null; }\n",
				"utf8",
			);
			for (const name of ["react", "react-dom"] as const) {
				const pkg = join(dir, "node_modules", name);
				await mkdir(pkg, { recursive: true });
				await writeFile(
					join(pkg, "package.json"),
					JSON.stringify({
						name,
						version: "18.3.1",
						main: "index.js",
						exports:
							name === "react"
								? { ".": "./index.js" }
								: { "./client": "./client.js" },
					}),
					"utf8",
				);
				await writeFile(
					join(pkg, "index.js"),
					"export const createElement = () => null; export const createRoot = () => ({ render() {} });\n",
					"utf8",
				);
				await writeFile(
					join(pkg, "client.js"),
					"export const createRoot = () => ({ render() {} });\n",
					"utf8",
				);
			}
			const detection = await detectSingle({ single: "app.tsx", dir });
			if (detection.kind !== "app") throw new Error(`expected an app, got ${detection.kind}`);
			const build = await buildPage(detection.app, { dev: false });
			const page = await Bun.file(join(build.dir, PAGE_ENTRY)).text();
			expect(page).toContain("createRoot");
			expect(page).toContain("getElementById");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}, 30_000);
});
