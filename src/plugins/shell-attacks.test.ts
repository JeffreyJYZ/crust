/**
 * The attacks the security review measured, each one performed against the real plugin and refused: a page-supplied `env` that turns an allowlisted program into an execution primitive, a file the page named `echo`, a symlink that borrows an allowed name or leaves `cwdRoot`, and a `cwd` that is a symlink out.
 * The last test is the other half of the proof: a permitted program still runs, from the real path the check approved.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SpawnOutcome } from "@/plugins/shell";
import { type ShellHarness, shellHarness } from "@/plugins/shell-fixture";

let h: ShellHarness;

beforeEach(async () => {
	h = await shellHarness();
});

afterEach(async () => {
	await h.stop();
});

/** The code and message of a refusal; fails the test if the payload was accepted. */
function refusal(outcome: SpawnOutcome): { code: string; message: string } {
	if (outcome.ok) throw new Error(`expected a refusal, got process ${outcome.id}`);
	return { code: outcome.code, message: outcome.message };
}

/** An executable a page could have written, at whatever name it likes. */
function executable(path: string): string {
	writeFileSync(path, "#!/bin/sh\necho pwned\n", { mode: 0o755 });
	chmodSync(path, 0o755);
	return path;
}

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

describe("a program is a real path, not a basename", () => {
	test("a file the page named echo inside cwdRoot is not echo", async () => {
		executable(join(h.root, "echo"));
		for (const program of ["./echo", join(h.root, "echo")]) {
			const refused = refusal(await h.spawn({ program }));
			expect(refused.code).toBe("program-not-allowed");
			expect(refused.message).toContain("resolves to");
		}
	});

	test("a symlink that borrows an allowed basename is refused", async () => {
		const payload = executable(join(h.root, "payload"));
		symlinkSync(payload, join(h.root, "echo"));
		const refused = refusal(await h.spawn({ program: "./echo" }));
		expect(refused.code).toBe("program-not-allowed");
		expect(refused.message).toContain(realpathSync(payload));
	});

	test("a symlink that leaves cwdRoot is refused, naming the target", async () => {
		const dir = mkdtempSync(join(tmpdir(), "crust-outside-"));
		try {
			symlinkSync(executable(join(dir, "echo")), join(h.root, "echo"));
			const refused = refusal(await h.spawn({ program: "./echo" }));
			expect(refused.code).toBe("program-outside-root");
			expect(refused.message).toContain("through a symlink");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("an absolute entry matches the real file, whichever way it is named", async () => {
		const echo = Bun.which("echo");
		if (echo === null) throw new Error("echo is not on PATH");
		const only = await shellHarness({ allow: [realpathSync(echo)] });
		try {
			const id = await only.id({ program: "echo", args: ["absolute"] });
			expect((await only.settled(id)).stdout).toBe("absolute");
			executable(join(only.root, "echo"));
			const refused = refusal(await only.spawn({ program: "./echo" }));
			expect(refused.code).toBe("program-not-allowed");
		} finally {
			await only.stop();
		}
	});
});

describe("a cwd is a real path too", () => {
	test("a symlinked cwd that leaves cwdRoot is refused", async () => {
		const outside = mkdtempSync(join(tmpdir(), "crust-outside-"));
		try {
			symlinkSync(outside, join(h.root, "away"));
			const refused = refusal(await h.spawn({ program: "echo", cwd: "away" }));
			expect(refused.code).toBe("cwd-not-allowed");
			expect(refused.message).toContain("through a symlink");
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});
});

describe("a permitted program", () => {
	test("still runs, from the real path the allow list approved", async () => {
		const id = await h.id({ program: "echo", args: ["still", "works"] });
		expect(await h.settled(id)).toEqual({
			ok: true,
			stdout: "still works",
			stderr: "",
			exitCode: 0,
			signal: null,
		});
	});
});
