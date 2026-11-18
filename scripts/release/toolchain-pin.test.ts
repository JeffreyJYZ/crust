/**
 * The release workflow must pin Bun. The standalone binary's bytes depend on the compiler,
 * and an unpinned `setup-bun` silently tracks whatever is current that week.
 */
import { expect, test } from "bun:test";

const source = await Bun.file(
	new URL("../../.github/workflows/release.yml", import.meta.url),
).text();

/** The `with:` block that follows each `setup-bun` step. */
function pinBlocks(): string[] {
	const lines = source.split("\n");
	return lines.flatMap((line, index) =>
		line.includes("uses: oven-sh/setup-bun@")
			? [lines.slice(index + 1, index + 4).join("\n")]
			: [],
	);
}

test("every setup-bun step pins the exact stable version", () => {
	const blocks = pinBlocks();
	expect(blocks.length).toBeGreaterThan(0);
	for (const block of blocks) expect(block).toContain("bun-version: 1.4.4");
});

test("the pin is a fixed release, never a floating canary", () => {
	expect(source).not.toMatch(/bun-version:\s*canary/i);
});
