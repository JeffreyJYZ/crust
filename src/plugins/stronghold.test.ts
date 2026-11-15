/**
 * `crust:stronghold` against a temp root: the locked gate, the file header's crypto parameters, the round trip, and the
 * one proof that matters — the file's bytes hold no plaintext, and a wrong password is refused instead of opening an
 * empty store. Nothing here writes outside the temp directory, and every password is short on purpose.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createStrongholdPlugin,
	KDF_ITERATIONS,
	SALT_BYTES,
	type StrongholdFile,
	STORE_FILE,
} from "@/plugins/stronghold";

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
	return await mkdtemp(join(tmpdir(), "crust-stronghold-"));
}

function storeAt(root: string): Plugin {
	return createStrongholdPlugin({ root });
}

describe("stronghold locked", () => {
	test("every command but open and close answers locked before open", async () => {
		const root = await scratch();
		try {
			const call = caller(storeAt(root));
			for (const [name, args] of [
				["get", { key: "a" }],
				["set", { key: "a", value: "b" }],
				["delete", { key: "a" }],
				["keys", undefined],
			] as const) {
				expect(await call(name, args)).toEqual({
					ok: false,
					code: "locked",
					message: `stronghold.${name} needs open first`,
				});
			}
			expect(await call("close")).toEqual({ ok: true, closed: true });
			// A locked store never touched the disk.
			expect(await stat(join(root, STORE_FILE)).catch(() => undefined)).toBe(undefined);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("stronghold open", () => {
	test("writes a header with PBKDF2-SHA256, 600000 rounds, a 16-byte salt and mode 0600", async () => {
		const root = await scratch();
		try {
			const call = caller(storeAt(root));
			expect(await call("open", { password: "pw" })).toEqual({ ok: true, opened: true });
			const path = join(root, STORE_FILE);
			const file = JSON.parse(await readFile(path, "utf8")) as StrongholdFile;
			expect(file.version).toBe(1);
			expect(file.kdf.algorithm).toBe("PBKDF2-SHA256");
			expect(file.kdf.iterations).toBe(KDF_ITERATIONS);
			expect(KDF_ITERATIONS).toBe(600_000);
			expect(Buffer.from(file.kdf.salt, "base64")).toHaveLength(SALT_BYTES);
			expect(file.entries).toEqual({});
			expect((await stat(path)).mode & 0o777).toBe(0o600);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("an empty password, an empty key and a non-string value are bad requests", async () => {
		const root = await scratch();
		try {
			const call = caller(storeAt(root));
			expect(await call("open", { password: "" })).toMatchObject({ code: "bad-request" });
			await call("open", { password: "pw" });
			expect(await call("set", { key: "", value: "v" })).toMatchObject({
				code: "bad-request",
			});
			expect(await call("set", { key: "k", value: 7 })).toMatchObject({
				code: "bad-request",
			});
			expect(await call("get", {})).toMatchObject({ code: "bad-request" });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("a file that is not a store is corrupt, not an empty one", async () => {
		const root = await scratch();
		try {
			await writeFile(join(root, STORE_FILE), '{"version":9}\n');
			expect(await caller(storeAt(root))("open", { password: "pw" })).toMatchObject({
				code: "corrupt",
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("stronghold entries", () => {
	test("set, get, keys and delete round trip inside one session", async () => {
		const root = await scratch();
		try {
			const call = caller(storeAt(root));
			await call("open", { password: "pw" });
			expect(await call("set", { key: "token", value: "abc" })).toEqual({
				ok: true,
				key: "token",
			});
			await call("set", { key: "other", value: "xyz" });
			expect(await call("get", { key: "token" })).toEqual({
				ok: true,
				key: "token",
				value: "abc",
			});
			expect(await call("keys")).toEqual({ ok: true, keys: ["other", "token"] });
			expect(await call("get", { key: "missing" })).toMatchObject({ code: "not-found" });
			expect(await call("delete", { key: "token" })).toEqual({
				ok: true,
				key: "token",
				deleted: true,
			});
			expect(await call("delete", { key: "token" })).toEqual({
				ok: true,
				key: "token",
				deleted: false,
			});
			expect(await call("keys")).toEqual({ ok: true, keys: ["other"] });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("stronghold at rest", () => {
	test("the file holds no plaintext, and only the password opens it again", async () => {
		const root = await scratch();
		try {
			const path = join(root, STORE_FILE);
			const call = caller(storeAt(root));
			await call("open", { password: "pw" });
			await call("set", { key: "api-token", value: "sk-plaintext-must-not-appear" });
			expect(await call("close")).toEqual({ ok: true, closed: true });

			const bytes = await readFile(path, "utf8");
			expect(bytes).not.toContain("sk-plaintext-must-not-appear");
			expect(bytes).not.toContain("api-token");
			expect(bytes).toContain('"iv"');
			const salt = (JSON.parse(bytes) as StrongholdFile).kdf.salt;

			const reopened = caller(storeAt(root));
			expect(await reopened("open", { password: "pw" })).toEqual({ ok: true, opened: true });
			expect(await reopened("get", { key: "api-token" })).toEqual({
				ok: true,
				key: "api-token",
				value: "sk-plaintext-must-not-appear",
			});

			const wrong = caller(storeAt(root));
			expect(await wrong("open", { password: "nope" })).toMatchObject({
				ok: false,
				code: "bad-password",
			});
			// A refused password leaves nothing usable and does not rewrite the store.
			expect(await wrong("keys")).toMatchObject({ code: "locked" });
			expect((JSON.parse(await readFile(path, "utf8")) as StrongholdFile).kdf.salt).toBe(
				salt,
			);
			expect(await caller(storeAt(root))("open", { password: "pw" })).toEqual({
				ok: true,
				opened: true,
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
