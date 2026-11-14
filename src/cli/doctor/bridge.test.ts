/**
 * The bridge port doctor derives, pinned to the port the real runtime binds.
 *
 * `preferredPort` duplicates `preferredPortFor` in `src/runtime.ts`; this pair
 * is what fails the suite instead of letting the copy go stale.
 */

import { describe, expect, test } from "bun:test";
import { preferredPort } from "../doctor.ts";
import { crustRoot } from "../util.ts";

describe("preferredPort", () => {
	test("is stable, in the runtime's range, and differs between ids", () => {
		const hello = preferredPort("land.jyz.hello");
		expect(hello).toBe(preferredPort("land.jyz.hello"));
		expect(hello).toBeGreaterThanOrEqual(45000);
		expect(hello).toBeLessThan(49000);
		expect(preferredPort("land.jyz.notes")).not.toBe(hello);
	});

	test("matches the port the real runtime binds for the same id", async () => {
		const id = "dev.crust.doctor-port-probe";
		const script = [
			'import { startApp } from "./src/runtime.ts";',
			"const id = process.env.CRUST_DOCTOR_PROBE_ID;",
			"const handle = await startApp({",
			'\tconfig: { app: { id, name: "doctor probe", version: "0.0.0" }, windows: [{ label: "main" }] },',
			"\tattachPlatform: false,",
			"\tassets: {},",
			'\troot: "/nonexistent-crust-doctor-root",',
			"\tentryModule: async () => {},",
			"});",
			'console.log("CRUST_DOCTOR_PORT=" + handle.port);',
			"await handle.stop();",
			"process.exit(0);",
		].join("\n");
		const child = Bun.spawn({
			cmd: [process.execPath, "-e", script],
			cwd: crustRoot,
			env: { ...process.env, CRUST_DOCTOR_PROBE_ID: id },
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, byRuntime, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect(byRuntime).toBe("");
		expect(code).toBe(0);
		const match = /CRUST_DOCTOR_PORT=(\d+)/.exec(stdout);
		expect(match?.[1]).toBeDefined();
		expect(Number(match?.[1])).toBe(preferredPort(id));
	});
});
