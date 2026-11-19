/**
 * The CLI contract, pinned end to end through the real entry point before the
 * cac rewrite lands. One table row per behaviour; each row spawns `index.ts`
 * the way `first-run.test.ts` does, because argv handling sets `process.exitCode`
 * at module load and cannot be imported twice.
 *
 * Only rows that fail before a project, certificate or display is needed are
 * here: help, version, unknown/missing-value/flag-scope errors, the stage
 * refusals, the removed verbs, and the no-config throw. The rows live next door
 * in cli-contract-rows.ts so neither file passes the 200-line cap.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROWS } from "./cli-contract-rows.ts";

const ENTRY = join(import.meta.dir, "index.ts");

interface Run {
	out: string;
	err: string;
	code: number;
}

async function runCli(args: string[], env?: Record<string, string>): Promise<Run> {
	const child = Bun.spawn({
		cmd: [process.execPath, "run", ENTRY, ...args],
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, ...(env ?? {}) },
	});
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { out, err, code };
}

describe("CLI contract (baseline the cac refactor must keep)", () => {
	for (const row of ROWS) {
		test(row.name, async () => {
			let dir: string | undefined;
			let args = row.args;
			if (row.freshDir) {
				dir = await mkdtemp(join(tmpdir(), "crust-contract-"));
				args = args.map((arg) => (arg === "<DIR>" ? dir! : arg));
			}
			try {
				const run = await runCli(args, row.env);
				expect(run.code, `exit code: ${row.name}`).toBe(row.code);
				for (const text of row.out ?? []) {
					expect(run.out, `stdout contains ${text}: ${row.name}`).toContain(text);
				}
				for (const text of row.err ?? []) {
					expect(run.err, `stderr contains ${text}: ${row.name}`).toContain(text);
				}
				for (const text of row.outNot ?? []) {
					expect(run.out, `stdout omits ${text}: ${row.name}`).not.toContain(text);
				}
				if (row.outEmpty) expect(run.out, `stdout empty: ${row.name}`).toBe("");
				if (row.errEmpty) expect(run.err, `stderr empty: ${row.name}`).toBe("");
			} finally {
				if (dir) await rm(dir, { recursive: true, force: true });
			}
		});
	}
});
