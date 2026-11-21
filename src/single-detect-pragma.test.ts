/**
 * The `crust-security:` declaration is a comment in the source, not a string in its prose. A page
 * that prints the pragma as an example inside `<pre>` must not silently run under that policy.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectSingle } from "@/single-detect.ts";

const PRAGMA = '// crust-security: {"microphone":"Example records voice memos."}';
const HTML_PRAGMA = '<!-- crust-security: {"microphone":"Example records voice memos."} -->';

async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "crust-single-pragma-"));
	try {
		await run(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

async function security(dir: string, file: string, source: string): Promise<unknown> {
	await writeFile(join(dir, file), source, "utf8");
	const detection = await detectSingle({ single: file, dir });
	if (detection.kind !== "app") throw new Error(`expected an app, got ${detection.kind}`);
	return detection.app.config.security;
}

describe("a single-file security pragma", () => {
	test("a pragma printed inside a <pre> does not configure the app", async () => {
		await withDir(async (dir) => {
			const source = [
				"<!doctype html><html><body>",
				"<pre>",
				HTML_PRAGMA,
				"</pre>",
				"<h1>hi</h1></body></html>",
			].join("\n");
			expect(await security(dir, "page.html", source)).toBeUndefined();
		});
	});

	test("a real pragma after an illustrative <pre> still configures the app", async () => {
		await withDir(async (dir) => {
			const source = [
				HTML_PRAGMA,
				"<html><body>",
				"<pre>",
				HTML_PRAGMA,
				"</pre>",
				"<h1>hi</h1></body></html>",
			].join("\n");
			expect(await security(dir, "page.html", source)).toEqual({
				microphone: "Example records voice memos.",
			});
		});
	});

	test("a pragma inside a block comment does not configure the app", async () => {
		await withDir(async (dir) => {
			const source = [`/* ${PRAGMA} */`, "export default 1;"].join("\n");
			expect(await security(dir, "app.tsx", source)).toBeUndefined();
		});
	});
});
