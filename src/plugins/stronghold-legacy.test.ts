/**
 * The upgrade consequence of moving stronghold to a per-app root: an old machine-wide vault still on
 * disk has entries that cannot be attributed to one app, so it is never migrated. The first fresh
 * vault must say so, naming both paths, instead of answering `not-found` for every old secret with
 * no explanation. No secret is read from the legacy file here.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureLogger, flushLogger, parseLine, resetLogger } from "@/logging";
import { noteLegacyVault } from "@/plugins/stronghold-legacy.ts";
import { STORE_FILE } from "@/plugins/stronghold.ts";

let root: string | undefined;
let savedDir: string | undefined;

afterEach(async () => {
	resetLogger();
	if (savedDir === undefined) delete process.env.CRUST_DATA_DIR;
	else process.env.CRUST_DATA_DIR = savedDir;
	if (root !== undefined) await rm(root, { recursive: true, force: true });
	root = undefined;
});

async function withLegacy(): Promise<{ legacy: string; fresh: string }> {
	root = await mkdtemp(join(tmpdir(), "crust-stronghold-legacy-"));
	savedDir = process.env.CRUST_DATA_DIR;
	process.env.CRUST_DATA_DIR = root;
	configureLogger({ root, level: "warn" });
	const legacy = join(root, STORE_FILE);
	const fresh = join(root, "land.jyz.app", STORE_FILE);
	return { legacy, fresh };
}

async function lines(): Promise<string[]> {
	await flushLogger();
	const text = await readFile(join(root!, "logs", "app.jsonl"), "utf8").catch(() => "");
	return text
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.stringify(parseLine(line)));
}

describe("the legacy vault note", () => {
	test("one warn line names both paths when a fresh vault is created beside the old file", async () => {
		const { legacy, fresh } = await withLegacy();
		await writeFile(legacy, "not a vault we read\n");
		await noteLegacyVault(fresh);
		const parsed = (await lines()).map((line) => JSON.parse(line) as Record<string, unknown>);
		const notes = parsed.filter((record) => record.event === "stronghold.legacy-vault");
		expect(notes).toHaveLength(1);
		expect(notes[0]!.level).toBe("warn");
		expect(notes[0]!.msg).toContain(legacy);
		expect(notes[0]!.msg).toContain(fresh);
	});

	test("no legacy file, and the override where both paths are one, stay silent", async () => {
		const { fresh } = await withLegacy();
		await noteLegacyVault(fresh);
		expect(await lines()).toEqual([]);
		await writeFile(join(root!, STORE_FILE), "legacy\n");
		await noteLegacyVault(join(root!, STORE_FILE));
		expect(await lines()).toEqual([]);
	});
});
