/**
 * The attacks the security review measured against `env`, each one performed against the real plugin and refused: `NODE_OPTIONS=--require /tmp/evil.js` turns any allowlisted program into an execution primitive, and `DYLD_*` replaces the loader's libraries.
 * The last test is the other half of the proof: with the host's opt-in, a benign variable still reaches the program.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { type ShellHarness, refusal, shellHarness } from "@/plugins/shell-fixture";

let h: ShellHarness;

beforeEach(async () => {
	h = await shellHarness();
});

afterEach(async () => {
	await h.stop();
});

describe("a page-supplied env", () => {
	test("is refused by default, before the program is looked up", async () => {
		const refused = refusal(
			await h.spawn({ program: "echo", env: { NODE_OPTIONS: "--require /tmp/evil.js" } }),
		);
		expect(refused.code).toBe("env-not-allowed");
		expect(refused.message).toContain("createShellPlugin({ env: true })");
	});

	test("still refuses every injection name once the host opts in, naming it", async () => {
		const open = await shellHarness({ env: true });
		try {
			const names = [
				"NODE_OPTIONS",
				"BASH_ENV",
				"ENV",
				"GIT_EXEC_PATH",
				"PYTHONSTARTUP",
				"PERL5OPT",
				"RUBYOPT",
				"LD_PRELOAD",
				"DYLD_INSERT_LIBRARIES",
				"DYLD_LIBRARY_PATH",
			];
			for (const name of names) {
				const refused = refusal(
					await open.spawn({ program: "echo", env: { [name]: "x" } }),
				);
				expect(refused.code).toBe("env-not-allowed");
				expect(refused.message).toContain(JSON.stringify(name));
			}
		} finally {
			await open.stop();
		}
	});

	test("finding 3: lowercase spellings are refused too, because Windows names fold", async () => {
		const open = await shellHarness({ env: true });
		try {
			for (const name of [
				"node_options",
				"bash_env",
				"ld_preload",
				"dyld_insert_libraries",
			]) {
				const refused = refusal(
					await open.spawn({ program: "echo", env: { [name]: "x" } }),
				);
				expect(refused.code).toBe("env-not-allowed");
				expect(refused.message).toContain(JSON.stringify(name));
			}
		} finally {
			await open.stop();
		}
	});

	test("a benign variable does reach the program when the host opts in", async () => {
		const open = await shellHarness({ env: true });
		try {
			const id = await open.id({
				program: "printenv",
				args: ["CRUST_TEST_VALUE"],
				env: { CRUST_TEST_VALUE: "reached" },
			});
			expect((await open.settled(id)).stdout).toBe("reached");
		} finally {
			await open.stop();
		}
	});
});
