/**
 * A probe beside a running build must not raise the user's app: two runtimes with the
 * same app id but different project directories both acquire their own lock. An
 * explicit single-instance.id names a lock the caller owns.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateConfig } from "@/config";
import { claimSingleInstance, lockIdFor } from "../runtime-single.ts";
import type { SingleInstanceAdapter } from "@/plugins/single-instance.ts";

const config = {
	app: { id: "land.jyz.same-app", name: "same", version: "0.0.0" },
	windows: [{ label: "main", url: "/" }],
};

describe("single-instance isolation", () => {
	test("one app id in two project dirs names two different locks", () => {
		const a = lockIdFor(config, "/projects/alpha");
		const b = lockIdFor(config, "/projects/beta");
		expect(a).not.toBe(b);
		expect(a).toContain("same-app");
	});

	test("an explicit single-instance.id wins over the derived one", () => {
		const named = validateConfig({
			...config,
			singleInstance: { id: "probe-one" },
		});
		expect(lockIdFor(named, "/projects/alpha")).toBe("probe-one");
	});

	test("two runtimes with one app id and different dirs both acquire", async () => {
		const dir = mkdtempSync(join(tmpdir(), "crust-lock-iso-"));
		try {
			const adapter: SingleInstanceAdapter = {
				activate: () => ({ status: 0, reason: "ok" }),
			};
			const first = await claimSingleInstance({
				config,
				projectDir: join(dir, "alpha"),
				dir,
				adapter,
				platform: "darwin",
			});
			const second = await claimSingleInstance({
				config,
				projectDir: join(dir, "beta"),
				dir,
				adapter,
				platform: "darwin",
			});
			expect(first.acquired).toBe(true);
			expect(second.acquired).toBe(true);
			expect(first.path).not.toBe(second.path);
			first.release();
			second.release();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
