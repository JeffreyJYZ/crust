/**
 * The finding this file pins: `stronghold`'s write queue used to be per plugin instance, so two
 * instances over one vault each captured the same `entries` snapshot at `open` and the later atomic
 * rename dropped the earlier key — while both commands answered `ok`. The queue is now the
 * module-scoped file lock `store` already uses, and every mutation re-reads the file inside it.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStrongholdPlugin, STORE_FILE, type StrongholdFile } from "@/plugins/stronghold";

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
	return await mkdtemp(join(tmpdir(), "crust-stronghold-concurrent-"));
}

/** A fresh instance, opened: the only honest witness of what the file actually holds. */
async function opened(root: string, password = "pw"): Promise<Call> {
	const call = caller(createStrongholdPlugin({ root }));
	expect(await call("open", { password })).toEqual({ ok: true, opened: true });
	return call;
}

describe("two instances over one vault", () => {
	test("concurrent set keeps both secrets instead of letting the later rename drop one", async () => {
		const root = await scratch();
		try {
			const a = caller(createStrongholdPlugin({ root }));
			const b = caller(createStrongholdPlugin({ root }));
			expect(await a("open", { password: "pw" })).toEqual({ ok: true, opened: true });
			expect(await b("open", { password: "pw" })).toEqual({ ok: true, opened: true });

			expect(
				await Promise.all([
					a("set", { key: "alpha", value: "1" }),
					b("set", { key: "beta", value: "2" }),
				]),
			).toEqual([
				{ ok: true, key: "alpha" },
				{ ok: true, key: "beta" },
			]);

			const witness = await opened(root);
			expect(await witness("get", { key: "alpha" })).toMatchObject({ ok: true, value: "1" });
			expect(await witness("get", { key: "beta" })).toMatchObject({ ok: true, value: "2" });
			expect(await witness("keys")).toEqual({ ok: true, keys: ["alpha", "beta"] });
			const file = JSON.parse(
				await readFile(join(root, STORE_FILE), "utf8"),
			) as StrongholdFile;
			expect(Object.keys(file.entries)).toHaveLength(2);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("concurrent deletes of different keys both land", async () => {
		const root = await scratch();
		try {
			const seed = await opened(root);
			expect(await seed("set", { key: "alpha", value: "1" })).toMatchObject({ ok: true });
			expect(await seed("set", { key: "beta", value: "2" })).toMatchObject({ ok: true });
			const a = await opened(root);
			const b = await opened(root);

			expect(
				await Promise.all([a("delete", { key: "alpha" }), b("delete", { key: "beta" })]),
			).toEqual([
				{ ok: true, key: "alpha", deleted: true },
				{ ok: true, key: "beta", deleted: true },
			]);

			const witness = await opened(root);
			expect(await witness("keys")).toEqual({ ok: true, keys: [] });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a concurrent open cannot replace a commit that lands beside it", async () => {
		const root = await scratch();
		try {
			const a = await opened(root);
			const b = caller(createStrongholdPlugin({ root }));
			await Promise.all([
				a("set", { key: "kept", value: "v" }),
				b("open", { password: "pw" }),
			]);

			const witness = await opened(root);
			expect(await witness("get", { key: "kept" })).toMatchObject({ ok: true, value: "v" });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("a replaced header", () => {
	test("a write refuses instead of sealing entries under keys the new vault cannot read", async () => {
		const root = await scratch();
		try {
			const a = await opened(root, "first");
			// The file is replaced out of band; a second app creates a fresh vault under a new password.
			await rm(join(root, STORE_FILE), { force: true });
			await opened(root, "second");
			expect(await a("set", { key: "token", value: "v" })).toMatchObject({
				ok: false,
				code: "corrupt",
			});
			const witness = await opened(root, "second");
			expect(await witness("keys")).toEqual({ ok: true, keys: [] });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
