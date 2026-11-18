import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { devBackendEntry, htmlModuleEntry } from "../dev.ts";

const roots: string[] = [];

async function project(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "crust-dev-entry-"));
	roots.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("devBackendEntry", () => {
	test("a page whose HTML loads src/main.ts falls back to the backend main.ts", async () => {
		const dir = await project();
		await mkdir(join(dir, "src"), { recursive: true });
		await writeFile(
			join(dir, "index.html"),
			`<html><body><script type="module" src="/src/main.ts"></script></body></html>`,
			"utf8",
		);
		await writeFile(join(dir, "src", "main.ts"), `document.body.style.margin = "0";\n`, "utf8");
		await writeFile(
			join(dir, "main.ts"),
			`import { app } from "crust";\nawait app.run();\n`,
			"utf8",
		);

		expect(await htmlModuleEntry(dir)).toBe("src/main.ts");
		const entry = await devBackendEntry(dir);
		expect(entry?.path).toBe(join(dir, "main.ts"));
	});

	test("when src/main.ts is not the page entry, the backend convention still wins", async () => {
		const dir = await project();
		await mkdir(join(dir, "src"), { recursive: true });
		await writeFile(
			join(dir, "index.html"),
			`<html><body><script type="module" src="/src/main.tsx"></script></body></html>`,
			"utf8",
		);
		await writeFile(
			join(dir, "src", "main.ts"),
			`await (await import("crust")).app.run();\n`,
			"utf8",
		);
		await writeFile(join(dir, "main.ts"), `export default 1;\n`, "utf8");

		const entry = await devBackendEntry(dir);
		expect(entry?.path).toBe(join(dir, "src", "main.ts"));
	});

	test("an explicit --entry is honoured even when the page names src/main.ts", async () => {
		const dir = await project();
		await mkdir(join(dir, "src"), { recursive: true });
		await writeFile(
			join(dir, "index.html"),
			`<html><body><script type="module" src="/src/main.ts"></script></body></html>`,
			"utf8",
		);
		await writeFile(
			join(dir, "src", "main.ts"),
			`document.body.textContent = "page";\n`,
			"utf8",
		);
		await writeFile(join(dir, "backend.ts"), `export default 1;\n`, "utf8");

		const entry = await devBackendEntry(dir, "backend.ts");
		expect(entry).toEqual({ path: join(dir, "backend.ts"), explicit: true });
	});
});
