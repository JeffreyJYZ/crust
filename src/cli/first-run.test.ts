/**
 * First-run CLI ergonomics, pinned end to end through the real entry point:
 * a missing config points at `crust init`, a mistyped command with `--help`
 * fails, and `crust <command> --help` answers only that command.
 *
 * These spawn a fresh process because argv handling lives in `index.ts`,
 * which sets `process.exitCode` at module load and cannot be imported twice.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY = join(import.meta.dir, "index.ts");

interface Run {
	out: string;
	err: string;
	code: number;
}

async function runCli(...args: string[]): Promise<Run> {
	const child = Bun.spawn({
		cmd: [process.execPath, "run", ENTRY, ...args],
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { out, err, code };
}

async function configlessDir(prefix: string): Promise<string> {
	return await mkdtemp(join(tmpdir(), prefix));
}

describe("first-run CLI messages", () => {
	test("dev in a configless directory names crust init", async () => {
		const dir = await configlessDir("crust-first-run-dev-");
		try {
			const run = await runCli("dev", "--dir", dir);
			expect(run.code).toBe(1);
			expect(run.err).toContain("no crust config");
			expect(run.err).toContain("crust init");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("build in a configless directory names crust init", async () => {
		const dir = await configlessDir("crust-first-run-build-");
		try {
			const run = await runCli("build", "--dir", dir);
			expect(run.code).toBe(1);
			expect(run.err).toContain("no crust config");
			expect(run.err).toContain("crust init");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("an unknown subcommand with --help exits non-zero and names the typo", async () => {
		const run = await runCli("bogus", "--help");
		expect(run.code).not.toBe(0);
		expect(run.err).toContain("unknown command");
		expect(run.err).toContain("bogus");
	});

	test("subcommand --help is scoped to that command", async () => {
		const run = await runCli("dev", "--help");
		expect(run.code).toBe(0);
		expect(run.out).toContain("crust dev");
		expect(run.out).toContain("watch the backend");
		expect(run.out).not.toContain("crust notarize");
		expect(run.out).not.toContain("drag-to-Applications");
	});

	test("global --help still names every command", async () => {
		const run = await runCli("--help");
		expect(run.code).toBe(0);
		for (const command of [
			"init",
			"dev",
			"build",
			"sign",
			"dmg",
			"package",
			"notarize",
			"doctor",
		]) {
			expect(run.out).toContain(`crust ${command}`);
		}
	});
});
