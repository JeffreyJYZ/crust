/**
 * The containment check, exercised across every escape the page can send.
 *
 * Run with `bun test examples/notes/paths.test.ts`. No window, no bridge, no
 * filesystem writes: `resolveNotePath` is pure, so this is the cheap proof that
 * the guard is the reason the app can take a name from the page at all.
 */
import { describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { MAX_NAME_LENGTH, resolveNotePath } from "./paths.ts";

const BASE = resolve("/tmp/crust-notes-test");

describe("resolveNotePath", () => {
	test("accepts an ordinary name and keeps it one segment inside the directory", () => {
		const result = resolveNotePath("Shopping list", BASE);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.name).toBe("Shopping list");
		expect(result.path).toBe(resolve(BASE, "Shopping list.md"));
		expect(dirname(result.path)).toBe(BASE);
	});

	test("trims surrounding whitespace and keeps inner spaces", () => {
		const result = resolveNotePath("  a b  ", BASE);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.name).toBe("a b");
	});

	test.each([
		["../etc/passwd", "a parent escape"],
		["..", "the parent directory"],
		["../..", "two levels up"],
		[".", "the current directory"],
		["/etc/passwd", "an absolute path"],
		["~/secrets", "a home path"],
		["a/b", "a forward separator"],
		["a\\b", "a back separator"],
		["a\0b", "a NUL byte"],
		["", "empty"],
		["   ", "only whitespace"],
		[".hidden", "a leading dot"],
	])("refuses %p (%s)", (name) => {
		const result = resolveNotePath(name, BASE);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("bad-name");
	});

	test("refuses a name longer than the limit", () => {
		const result = resolveNotePath("a".repeat(MAX_NAME_LENGTH + 1), BASE);
		expect(result.ok).toBe(false);
	});

	test("refuses a non-string", () => {
		expect(resolveNotePath(42, BASE).ok).toBe(false);
		expect(resolveNotePath(null, BASE).ok).toBe(false);
		expect(resolveNotePath(undefined, BASE).ok).toBe(false);
	});

	test("every accepted path stays inside the directory it was given", () => {
		for (const name of [
			"a",
			"A1",
			"note-2",
			"with.dots",
			"under_score",
			"x".repeat(MAX_NAME_LENGTH),
		]) {
			const result = resolveNotePath(name, BASE);
			expect(result.ok).toBe(true);
			if (!result.ok) continue;
			expect(dirname(result.path)).toBe(BASE);
		}
	});
});
