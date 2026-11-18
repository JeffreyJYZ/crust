import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveBackendEntry } from "./util.ts";

/** The defect: the shared resolver picked `src/main.ts` even when index.html named it as the page module. */
const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(module?: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "crust-resolver-"));
	roots.push(dir);
	await mkdir(join(dir, "src"), { recursive: true });
	await writeFile(join(dir, "src", "main.ts"), "export const page = true;\n", "utf8");
	await writeFile(join(dir, "main.ts"), "export const backend = true;\n", "utf8");
	await writeFile(
		join(dir, "index.html"),
		module === undefined
			? "<html></html>"
			: `<html><script type="module" src="${module}"></script></html>`,
		"utf8",
	);
	return dir;
}

describe("resolveBackendEntry", () => {
	test("skips the HTML module entry and picks the root backend", async () => {
		const dir = await project("/src/main.ts");
		expect(await resolveBackendEntry(dir)).toEqual({
			path: join(dir, "main.ts"),
			explicit: false,
		});
	});

	test("keeps src/main.ts when the page module has a different name", async () => {
		const dir = await project("/src/frontend.ts");
		expect(await resolveBackendEntry(dir)).toEqual({
			path: join(dir, "src", "main.ts"),
			explicit: false,
		});
	});

	test("an explicit --entry still wins over the page module", async () => {
		const dir = await project("/src/main.ts");
		expect(await resolveBackendEntry(dir, "src/main.ts")).toEqual({
			path: join(dir, "src", "main.ts"),
			explicit: true,
		});
	});
});
