import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFsPlugin } from "@/plugins/fs";

type Plugin = ReturnType<typeof createFsPlugin>;

const BYTES = new Uint8Array([0, 1, 2, 0xff, 0xfe, 0x80, 0x41]);

async function scratch(): Promise<string> {
	return await realpath(await mkdtemp(join(tmpdir(), "crust-fsbin-")));
}

async function call<T>(plugin: Plugin, name: string, args?: unknown): Promise<T> {
	const handler = (plugin.commands as Record<string, (input: unknown) => Promise<unknown>>)[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return (await handler(args)) as T;
}

describe("fs.readBinary", () => {
	test("returns exact bytes, including non-UTF8 octets", async () => {
		const dir = await scratch();
		try {
			const file = join(dir, "pic.bin");
			await writeFile(file, BYTES);
			const got = await call<Uint8Array>(createFsPlugin(), "readBinary", { path: file });
			expect(got).toBeInstanceOf(Uint8Array);
			expect(Array.from(got)).toEqual(Array.from(BYTES));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("a missing path is not-found", async () => {
		const dir = await scratch();
		try {
			await expect(
				call(createFsPlugin(), "readBinary", { path: join(dir, "gone.bin") }),
			).rejects.toMatchObject({ code: "not-found" });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("fs.writeBinary", () => {
	test("writes exact real bytes and reports the count", async () => {
		const dir = await scratch();
		try {
			const file = join(dir, "out.bin");
			const result = await call<{ bytes: number }>(createFsPlugin(), "writeBinary", {
				path: file,
				bytes: BYTES,
			});
			expect(result.bytes).toBe(BYTES.length);
			expect(
				Array.from(
					await Bun.file(file)
						.arrayBuffer()
						.then((b) => new Uint8Array(b)),
				),
			).toEqual(Array.from(BYTES));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("accepts the bridge's tagged base64 argument from a page", async () => {
		const dir = await scratch();
		try {
			const file = join(dir, "tagged.bin");
			const tagged = { __crustBytes: Buffer.from(BYTES).toString("base64") };
			await call(createFsPlugin(), "writeBinary", { path: file, bytes: tagged });
			expect(
				Array.from(
					await Bun.file(file)
						.arrayBuffer()
						.then((b) => new Uint8Array(b)),
				),
			).toEqual(Array.from(BYTES));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("a bad tag or non-bytes value is bad-request", async () => {
		const dir = await scratch();
		try {
			const file = join(dir, "no.bin");
			const plugin = createFsPlugin();
			await expect(
				call(plugin, "writeBinary", { path: file, bytes: { __crustBytes: "!!!!" } }),
			).rejects.toMatchObject({ code: "bad-request" });
			await expect(
				call(plugin, "writeBinary", { path: file, bytes: "not bytes" }),
			).rejects.toMatchObject({ code: "bad-request" });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("fs.mkdir", () => {
	test("creates a nested chain recursively, then reports created=false", async () => {
		const dir = await scratch();
		try {
			const nested = join(dir, "a", "b", "c");
			const first = await call<{ path: string; created: boolean }>(
				createFsPlugin(),
				"mkdir",
				{
					path: nested,
				},
			);
			expect(first).toEqual({ path: nested, created: true });
			expect((await stat(nested)).isDirectory()).toBe(true);
			const again = await call<{ created: boolean }>(createFsPlugin(), "mkdir", {
				path: nested,
			});
			expect(again.created).toBe(false);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("fs binary + mkdir share the one scope rule", () => {
	test("readBinary, writeBinary and mkdir all refuse a path outside scope", async () => {
		const root = await scratch();
		try {
			const inside = join(root, "inside");
			const outside = join(root, "outside");
			await mkdir(inside, { recursive: true });
			await mkdir(outside, { recursive: true });
			await writeFile(join(outside, "secret.bin"), BYTES);
			const plugin = createFsPlugin({ allow: [inside], root });

			await expect(
				call(plugin, "readBinary", { path: join(outside, "secret.bin") }),
			).rejects.toMatchObject({ code: "outside-scope" });
			await expect(
				call(plugin, "writeBinary", { path: join(outside, "new.bin"), bytes: BYTES }),
			).rejects.toMatchObject({ code: "outside-scope" });
			await expect(
				call(plugin, "mkdir", { path: join(outside, "newdir") }),
			).rejects.toMatchObject({
				code: "outside-scope",
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
