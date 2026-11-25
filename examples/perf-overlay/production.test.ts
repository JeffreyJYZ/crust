import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MARKER } from "../../src/perf/overlay/overlay.ts";
import { buildOverlay, buildProduction } from "./build.ts";

describe("overlay production absence", () => {
	test("dev bundle carries the marker; production output does not", async () => {
		const dev = await buildOverlay();
		expect(dev).toContain(MARKER);
		const dir = mkdtempSync(join(tmpdir(), "crust-overlay-prod-"));
		try {
			const files = await buildProduction(dir);
			let bytes = "";
			for (const file of files) bytes += readFileSync(file, "utf8");
			expect(bytes.length).toBeGreaterThan(0);
			expect(bytes).not.toContain(MARKER);
			console.log(
				`production absence: ${files.length} file(s), 0 occurrences of "${MARKER}"`,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
