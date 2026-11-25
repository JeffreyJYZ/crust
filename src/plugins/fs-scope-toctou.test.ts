/**
 * The path a scope approved must be the path the command opens. The `realpath` hook reports the
 * in-scope decoy once, then flips the symlink to an outside secret before the read happens: a command
 * that uses the caller's raw string reads the secret, one that uses the approved path reads the decoy.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const original = { ...fs };
let link: string | undefined;
let pending = false;
let flips = 0;

// One-shot hook: the check sees the decoy, then the link is repointed at the secret. The wrapper
// delegates everything else, so every other test in the process keeps the real filesystem.
mock.module("node:fs/promises", () => ({
	...original,
	realpath: async (path: string) => {
		if (pending && path === link) {
			flips++;
			pending = false;
			if (link !== undefined) await original.rename(join(dirname(link), "swapped"), link);
			return join(dirname(link!), "decoy.txt");
		}
		return original.realpath(path);
	},
}));

// Import after the mock is registered: a static import would capture the real `realpath`.
const { createFsPlugin } = await import("@/plugins/fs");

afterEach(() => {
	pending = false;
	link = undefined;
	mock.restore();
});

type Plugin = ReturnType<typeof createFsPlugin>;

async function call<T>(plugin: Plugin, name: string, args: unknown): Promise<T> {
	const handler = (plugin.commands as Record<string, (input: unknown) => Promise<unknown>>)[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return (await handler(args)) as T;
}

describe("fs operates on the path the scope approved", () => {
	test("a symlink flipped after approval cannot redirect a read outside the scope", async () => {
		const base = await original.realpath(
			await original.mkdtemp(join(tmpdir(), "crust-toctou-")),
		);
		const inside = join(base, "inside");
		const outside = join(base, "outside");
		try {
			await original.mkdir(inside);
			await original.mkdir(outside);
			await original.writeFile(join(inside, "decoy.txt"), "INSIDE", "utf8");
			await original.writeFile(join(outside, "secret.txt"), "OUTSIDE", "utf8");
			link = join(inside, "link.txt");
			await original.symlink(join(inside, "decoy.txt"), link);
			await original.symlink(join(outside, "secret.txt"), join(inside, "swapped"));
			pending = true;
			expect(flips).toBe(0);
			// Before the fix this answers OUTSIDE: the escape is performed, not merely predicted.
			expect(
				await call<string>(
					createFsPlugin({ allow: [inside], root: base }),
					"readTextFile",
					{
						path: link,
					},
				),
			).toBe("INSIDE");
			expect(flips).toBe(1);
		} finally {
			await original.rm(base, { recursive: true, force: true });
		}
	});

	test("an in-scope file still reads through the canonical path", async () => {
		const base = await original.realpath(
			await original.mkdtemp(join(tmpdir(), "crust-toctou-")),
		);
		try {
			await original.writeFile(join(base, "kept.txt"), "kept", "utf8");
			const plugin = createFsPlugin({ allow: [base], root: base });
			expect(
				await call<string>(plugin, "readTextFile", { path: join(base, "kept.txt") }),
			).toBe("kept");
		} finally {
			await original.rm(base, { recursive: true, force: true });
		}
	});
});
