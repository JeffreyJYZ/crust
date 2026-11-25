import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildPage } from "./single-build.ts";
import { detectSingle, type SingleApp } from "./single-detect.ts";
import { RELOAD_FILE } from "./single-page.ts";

const roots: string[] = [];

/** A fresh real directory, removed when the file's tests finish. */
async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "crust-single-html-"));
	roots.push(dir);
	return dir;
}

/** Write `contents` as `name` inside `dir` and hand back its absolute path. */
async function source(dir: string, name: string, contents: string): Promise<string> {
	const file = join(dir, name);
	await writeFile(file, contents, "utf8");
	return file;
}

/** Detect a single file in `dir` and fail loudly unless it is an app. */
async function app(dir: string, name: string): Promise<SingleApp> {
	const detection = await detectSingle({ single: name, dir });
	if (detection.kind !== "app") throw new Error(`expected an app, got ${detection.kind}`);
	return detection.app;
}

afterAll(async () => {
	await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("detectSingle with an .html file", () => {
	test("accepts the file and names the app after it", async () => {
		const dir = await tempDir();
		await source(dir, "hello.html", "<h1>hello</h1>\n");

		const detection = await detectSingle({ single: "hello.html", dir });

		expect(detection.kind).toBe("app");
		if (detection.kind !== "app") return;
		expect(detection.app.name).toBe("hello");
		expect(detection.app.file).toBe(join(dir, "hello.html"));
		expect(detection.app.dir).toBe(dir);
		expect(detection.app.config.app.id).toBe("crust.single.hello");
		expect(detection.app.config.windows[0]?.title).toBe("hello");
	});

	test("rejects an unsupported extension and names .html among the accepted ones", async () => {
		const dir = await tempDir();
		await source(dir, "notes.md", "# not a page\n");

		const detection = await detectSingle({ single: "notes.md", dir });

		expect(detection.kind).toBe("error");
		if (detection.kind !== "error") return;
		expect(detection.message).toContain(".html");
		expect(detection.message).toContain("got .md");
	});
});

describe("buildPage with an .html entry", () => {
	test("dev copies the file verbatim beside a reload marker", async () => {
		const dir = await tempDir();
		const markup = "<!doctype html>\n<h1>dev</h1>\n";
		const file = await source(dir, "dev.html", markup);

		const build = await buildPage(await app(dir, "dev.html"), { dev: true });

		expect(build.entry).toBe("index.html");
		expect(build.dir).toBe(join(dir, ".crust", "single"));
		expect(await readFile(join(build.dir, "index.html"), "utf8")).toBe(markup);
		expect(await readFile(file, "utf8")).toBe(markup);
		expect((await readdir(build.dir)).sort()).toEqual(["index.html", RELOAD_FILE].sort());
	});

	test("a build writes under dist/single with no marker and no bundle", async () => {
		const dir = await tempDir();
		const markup = "<!doctype html>\n<h1>built</h1>\n";
		await source(dir, "built.html", markup);

		const build = await buildPage(await app(dir, "built.html"), { dev: false });

		expect(build.entry).toBe("index.html");
		expect(build.dir).toBe(join(dir, "dist", "single"));
		expect(await readFile(join(build.dir, "index.html"), "utf8")).toBe(markup);
		// No page.js and no reload marker: the document is the whole output.
		expect(await readdir(build.dir)).toEqual(["index.html"]);
		await expect(readFile(join(build.dir, RELOAD_FILE), "utf8")).rejects.toThrow();
	});

	test("an .html that happens to contain export default is still copied", async () => {
		const dir = await tempDir();
		// `export default` as page text: shape detection would want React, but an
		// .html entry never reaches it, so no node_modules and no rewrite.
		const markup = [
			"<!doctype html>",
			"<pre>export default function Page() { return null }</pre>",
			"",
		].join("\n");
		await source(dir, "text.html", markup);

		const build = await buildPage(await app(dir, "text.html"), { dev: true });

		expect(await readFile(join(build.dir, "index.html"), "utf8")).toBe(markup);
		expect((await readdir(build.dir)).sort()).toEqual(["index.html", RELOAD_FILE].sort());
	});

	test("switching a .tsx page to .html removes the stale bundle from dist/single", async () => {
		const dir = await tempDir();
		await source(dir, "app.tsx", "document.title = 'old';\n");
		const bundled = await buildPage(await app(dir, "app.tsx"), { dev: false });
		expect((await readdir(bundled.dir)).sort()).toEqual(["index.html", "page.js"]);

		await source(dir, "page.html", "<!doctype html>\n<h1>new</h1>\n");
		const html = await buildPage(await app(dir, "page.html"), { dev: false });

		// The old page.js must not survive into the new binary's embedded asset table.
		expect(await readdir(html.dir)).toEqual(["index.html"]);
		await expect(readFile(join(html.dir, "page.js"), "utf8")).rejects.toThrow();
	});
});
