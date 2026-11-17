/**
 * `downloads` destination containment against a real temp tree. The lexical check alone accepts a
 * pre-existing symlink inside the data root and WebKit then writes through it, so `destination`
 * canonicalises both ends before comparing. Nothing here downloads a byte: only the path is asked.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { destination } from "@/plugins/downloads-scope";

interface Tree {
	base: string;
	root: string;
	outside: string;
}

/** A data root and a sibling directory outside it, both real, under one temp base. */
async function scratch(): Promise<Tree> {
	const base = await mkdtemp(join(tmpdir(), "crust-downloads-scope-"));
	const root = join(base, "data");
	const outside = join(base, "outside");
	await mkdir(root, { recursive: true });
	await mkdir(outside, { recursive: true });
	return { base, root, outside };
}

describe("downloads destination", () => {
	test("a directory inside the root is accepted as written, existing or not", async () => {
		const { base, root } = await scratch();
		try {
			const inside = join(root, "files");
			await mkdir(inside, { recursive: true });
			expect(destination(root, inside)).toBe(inside);
			const missing = join(root, "not-created-yet");
			expect(destination(root, missing)).toBe(missing);
		} finally {
			await rm(base, { recursive: true, force: true });
		}
	});

	test("a symlink inside the root that points outside it is refused", async () => {
		const { base, root, outside } = await scratch();
		try {
			const link = join(root, "escape");
			await symlink(outside, link);
			expect(() => destination(root, link)).toThrow(/outside the app's data root/);
			// The same symlink one level down must not slip through either.
			expect(() => destination(root, join(link, "deeper"))).toThrow(
				/outside the app's data root/,
			);
		} finally {
			await rm(base, { recursive: true, force: true });
		}
	});

	test("a dangling symlink inside the root is refused before anything creates its target", async () => {
		const { base, root, outside } = await scratch();
		try {
			const link = join(root, "dllink");
			const absent = join(outside, "dl.txt");
			await symlink(absent, link);
			expect(() => destination(root, link)).toThrow(/outside the app's data root/);
			expect(() => destination(root, join(link, "deeper"))).toThrow(
				/outside the app's data root/,
			);
			// A dangling link that points back inside stays usable, so a page is not broken by its own tree.
			const inner = join(root, "future");
			const innerLink = join(root, "inner-link");
			await symlink(inner, innerLink);
			expect(destination(root, innerLink)).toBe(innerLink);
		} finally {
			await rm(base, { recursive: true, force: true });
		}
	});

	test("a relative path, a walk out, and a sibling that starts the root are refused", async () => {
		const { base, root } = await scratch();
		try {
			expect(() => destination(root, "relative")).toThrow(/not an absolute path/);
			expect(() => destination(root, `${root}-other`)).toThrow(/outside the app's data root/);
			expect(() => destination(root, join(root, "..", "outside"))).toThrow(
				/outside the app's data root/,
			);
		} finally {
			await rm(base, { recursive: true, force: true });
		}
	});
});
