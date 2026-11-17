/**
 * The tree digest is what `install` re-checks, so it has to name where a file sat and not only what
 * it was called: two bundles differing only by which directory holds a file must not share a digest.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DownloadResult, UpdaterFailure } from "@/plugins/updater";
import {
	digestOf,
	delivering,
	executableOf,
	plugin,
	scratch,
	UPDATE_URL,
} from "@/plugins/updater-fake";
import { nodeUpdaterAdapter } from "@/plugins/updater-node";

const adapter = nodeUpdaterAdapter();

async function tree(root: string, files: Record<string, string>): Promise<string> {
	for (const [path, body] of Object.entries(files)) {
		const full = join(root, path);
		await mkdir(join(full, ".."), { recursive: true });
		await writeFile(full, body, "utf8");
	}
	return root;
}

describe("the tree digest names a file's path, not its basename", () => {
	test("finding 1: a file moved to a sibling directory changes the digest", async () => {
		const dir = await scratch();
		try {
			const left = await tree(join(dir, "One.app"), {
				"Contents/marker.txt": "same",
				"Contents/Resources/a.txt": "payload",
			});
			const right = await tree(join(dir, "Two.app"), {
				"Contents/marker.txt": "same",
				"Contents/Other/a.txt": "payload",
			});
			const one = await adapter.sha256(left);
			const two = await adapter.sha256(right);
			expect(one).not.toBe(two);
			// The same tree digested twice is stable, so this is the naming and not ordering.
			expect(await adapter.sha256(left)).toBe(one);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("finding 1: two sibling directories holding one identically named file differ", async () => {
		const dir = await scratch();
		try {
			const first = await tree(join(dir, "First.app"), { "p/q/r.txt": "payload" });
			const second = await tree(join(dir, "Second.app"), { "p/q2/r.txt": "payload" });
			expect(await adapter.sha256(first)).not.toBe(await adapter.sha256(second));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("finding 1: a name at two different depths is not the same name", async () => {
		const dir = await scratch();
		try {
			// Under basenames these two trees hashed identically: `d a`, `f b.txt`, `f c.txt` both
			// times. The depth is exactly what the old stream dropped.
			const shallow = await tree(join(dir, "Shallow.app"), {
				"a/b.txt": "one",
				"c.txt": "two",
			});
			const deeper = await tree(join(dir, "Deeper.app"), {
				"a/b.txt": "one",
				"a/c.txt": "two",
			});
			expect(await adapter.sha256(shallow)).not.toBe(await adapter.sha256(deeper));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("finding 4: the bundle module ships one symlink contract, install's", async () => {
		const bundleModule = (await import("@/plugins/updater-bundle")) as Record<string, unknown>;
		// `linkedPath` refused a symlinked appPath, which `install` deliberately accepts:
		// `replaceBundle` resolves the link and renames the real bundle. Two contracts for one
		// case means a caller could be refused for something the plugin itself installs.
		expect("linkedPath" in bundleModule).toBe(false);
		expect(typeof bundleModule.ownBundleFailure).toBe("function");
	});

	test("finding 1: install refuses a verified tree rearranged between directories", async () => {
		const dir = await scratch();
		try {
			const source = await tree(join(dir, "Notes-new.app"), {
				"Contents/marker.txt": "new",
				"Contents/Resources/a.txt": "payload",
			});
			const appPath = await tree(join(dir, "Notes.app"), { "Contents/marker.txt": "old" });
			const commands = plugin(delivering(source), {}, executableOf(appPath));
			const file = (await commands.download({
				url: UPDATE_URL,
				sha256: await digestOf(source),
			})) as DownloadResult;
			// The tree stays byte-identical, but the file moves to another directory: the receipt
			// must catch that, or install renames a bundle nobody verified.
			await mkdir(join(file.path, "Contents", "Moved"), { recursive: true });
			await rename(
				join(file.path, "Contents", "Resources", "a.txt"),
				join(file.path, "Contents", "Moved", "a.txt"),
			);
			const installed = await commands.install({ path: file.path, appPath });
			expect(installed).toMatchObject({ ok: false, code: "hash-mismatch" });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
