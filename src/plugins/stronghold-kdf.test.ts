/**
 * The KDF's two bounds. A store file is the user's own, so its header can claim any round count: a
 * count below the floor is no work at all, and one above the ceiling is a denial of service the page
 * can aim at its own app. Both are refused before a key is derived, and a store written at either
 * bound still opens. Nothing here weakens a real store: the doctored file is written by the test
 * itself, and the password it was sealed under is the one the test already knows.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStrongholdPlugin, type StrongholdFile } from "@/plugins/stronghold";
import { createStore } from "@/plugins/stronghold-crypto";
import {
	KDF_ITERATIONS,
	KDF_MAX_ITERATIONS,
	KDF_MIN_ITERATIONS,
	readStore,
	STORE_FILE,
} from "@/plugins/stronghold-file";

type Plugin = ReturnType<typeof createStrongholdPlugin>;
type Call = (name: string, args?: unknown) => Promise<any>;

function caller(plugin: Plugin): Call {
	const table = plugin.commands as unknown as Record<
		string,
		(args?: unknown) => Promise<unknown>
	>;
	return async (name, args) => {
		const handler = table[name];
		if (handler === undefined) throw new Error(`no command ${name}`);
		return await handler(args);
	};
}

async function scratch(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "crust-stronghold-kdf-"));
}

/** A real store at the real floor, then its header rewritten to claim `iterations` rounds. */
async function doctored(root: string, iterations: number): Promise<string> {
	const path = join(root, STORE_FILE);
	const store = await createStore("pw");
	const file: StrongholdFile = {
		...store.file,
		kdf: { ...store.file.kdf, iterations },
	};
	await writeFile(path, `${JSON.stringify(file, null, "\t")}\n`, "utf8");
	return path;
}

describe("stronghold KDF floor", () => {
	test("the floor is the KDF's documented parameter", () => {
		expect(KDF_MIN_ITERATIONS).toBe(600_000);
		expect(KDF_MIN_ITERATIONS).toBe(KDF_ITERATIONS);
	});

	test("a header asking for one round is corrupt, and the message names the floor", async () => {
		const root = await scratch();
		try {
			const path = await doctored(root, 1);
			const read = await readStore(path);
			expect(read).toMatchObject({ ok: false, code: "corrupt" });
			if (!read.ok)
				expect(read.message).toContain(`below the KDF floor of ${KDF_MIN_ITERATIONS}`);
			expect(
				await caller(createStrongholdPlugin({ root }))("open", { password: "pw" }),
			).toMatchObject({ ok: false, code: "corrupt" });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("createStore refuses to write a header below the floor", async () => {
		await expect(createStore("pw", 1)).rejects.toThrow(
			`below the KDF floor of ${KDF_MIN_ITERATIONS}`,
		);
		await expect(createStore("pw", KDF_MIN_ITERATIONS - 1)).rejects.toThrow(
			/below the KDF floor/,
		);
	});

	test("a store written at the floor still opens", async () => {
		const root = await scratch();
		try {
			expect(
				await caller(createStrongholdPlugin({ root }))("open", { password: "pw" }),
			).toEqual({
				ok: true,
				opened: true,
			});
			const file = JSON.parse(
				await readFile(join(root, STORE_FILE), "utf8"),
			) as StrongholdFile;
			expect(file.kdf.iterations).toBe(KDF_MIN_ITERATIONS);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("stronghold KDF ceiling", () => {
	test("the ceiling leaves headroom above the parameter a build writes today", () => {
		expect(KDF_MAX_ITERATIONS).toBe(5_000_000);
		expect(KDF_MAX_ITERATIONS).toBeGreaterThan(KDF_ITERATIONS * 8 - 1);
	});

	test("a header asking for four billion rounds is corrupt, and the message names it", async () => {
		const root = await scratch();
		try {
			const path = await doctored(root, 4_000_000_000);
			const read = await readStore(path);
			expect(read).toMatchObject({ ok: false, code: "corrupt" });
			if (!read.ok) {
				expect(read.message).toContain("4000000000");
				expect(read.message).toContain(`above the KDF ceiling of ${KDF_MAX_ITERATIONS}`);
			}
			// And `open` refuses it by the same name, without deriving a key.
			expect(
				await caller(createStrongholdPlugin({ root }))("open", { password: "pw" }),
			).toMatchObject({ ok: false, code: "corrupt" });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("createStore refuses to write a header above the ceiling", async () => {
		await expect(createStore("pw", KDF_MAX_ITERATIONS + 1)).rejects.toThrow(
			`above the KDF ceiling of ${KDF_MAX_ITERATIONS}`,
		);
	});

	test("a store written at the ceiling still opens", async () => {
		const root = await scratch();
		try {
			const store = await createStore("pw", KDF_MAX_ITERATIONS);
			await writeFile(
				join(root, STORE_FILE),
				`${JSON.stringify(store.file, null, "\t")}\n`,
				"utf8",
			);
			expect(
				await caller(createStrongholdPlugin({ root }))("open", { password: "pw" }),
			).toEqual({ ok: true, opened: true });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
