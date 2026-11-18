import { describe, expect, test } from "bun:test";
import { registry } from "./registry.ts";
import { render } from "./render.ts";

const namespaces = await registry();
const table = render(namespaces);

/** The full text of one namespace's entry, including any wrapped continuation lines. */
function entry(name: string): string {
	const lines = table.split("\n");
	const start = lines.findIndex((line) => line.startsWith(`- \`${name}\``));
	if (start < 0) throw new Error(`no rendered entry for ${name}`);
	let end = start + 1;
	while (end < lines.length && !lines[end]?.startsWith("- `")) end++;
	return lines.slice(start, end).join("\n");
}

describe("skill command table", () => {
	test("store is listed with save", () => {
		expect(entry("store")).toContain("save");
	});

	test("window is listed with setCursorVisible", () => {
		expect(entry("window")).toContain("setCursorVisible");
	});

	test("one entry per namespace, matching the real registry", () => {
		const count = table.split("\n").filter((line) => line.startsWith("- `")).length;
		expect(count).toBe(namespaces.length);
		expect(namespaces.length).toBe(32);
	});
});
