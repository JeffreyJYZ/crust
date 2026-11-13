import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { missingInstall } from "@/cli/util";

async function project(manifest: unknown, installed: boolean): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "crust-missing-install-"));
	if (manifest !== undefined)
		await writeFile(join(dir, "package.json"), JSON.stringify(manifest), "utf8");
	if (installed) await mkdir(join(dir, "node_modules"), { recursive: true });
	return dir;
}

describe("missingInstall", () => {
	test("names the directory and the command when dependencies are declared but absent", async () => {
		const dir = await project({ dependencies: { crust: "1.0.0", react: "^19.0.0" } }, false);
		try {
			const message = await missingInstall(dir);
			expect(message).toContain("node_modules is missing");
			expect(message).toContain(dir);
			expect(message).toContain("bun install");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("stays quiet once node_modules exists", async () => {
		const dir = await project({ devDependencies: { vite: "^8.0.0" } }, true);
		try {
			expect(await missingInstall(dir)).toBeUndefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("stays quiet for a project with nothing to install, or no manifest at all", async () => {
		const empty = await project({ name: "nothing-declared" }, false);
		const bare = await project(undefined, false);
		try {
			expect(await missingInstall(empty)).toBeUndefined();
			expect(await missingInstall(bare)).toBeUndefined();
		} finally {
			await rm(empty, { recursive: true, force: true });
			await rm(bare, { recursive: true, force: true });
		}
	});

	test("does not invent a failure for a manifest it cannot parse", async () => {
		const dir = await mkdtemp(join(tmpdir(), "crust-missing-install-"));
		try {
			await writeFile(join(dir, "package.json"), "{ not json", "utf8");
			expect(await missingInstall(dir)).toBeUndefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
