/**
 * The attacks the security review measured against paths, each performed against the real plugin and refused: a file the page named `echo`, a symlink that borrows an allowed name or leaves `cwdRoot`, and a `cwd` that is a symlink out.
 * The rule they are tested against: the allow list says *what* may run, as a real path, while `cwdRoot` bounds the working directory and relative paths — so an allowlisted absolute program runs wherever it lives, and a relative one still has to resolve inside.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { type ShellHarness, refusal, shellHarness } from "@/plugins/shell-fixture";

let h: ShellHarness;

beforeEach(async () => {
	h = await shellHarness();
});

afterEach(async () => {
	await h.stop();
});

/** An executable a page could have written, at whatever name it likes. */
function executable(path: string): string {
	writeFileSync(path, "#!/bin/sh\necho pwned\n", { mode: 0o755 });
	chmodSync(path, 0o755);
	return path;
}

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

describe("the allow list decides what runs, cwdRoot decides where", () => {
	test("an allow-listed absolute program runs even outside cwdRoot", async () => {
		const dir = mkdtempSync(join(tmpdir(), "crust-outside-"));
		try {
			const program = realpathSync(executable(join(dir, "outside-tool")));
			const open = await shellHarness({ allow: [program] });
			try {
				const id = await open.id({ program });
				expect((await open.settled(id)).stdout).toBe("pwned");
			} finally {
				await open.stop();
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a relative program still has to resolve inside cwdRoot", async () => {
		const dir = mkdtempSync(join(tmpdir(), "crust-outside-"));
		try {
			const program = realpathSync(executable(join(dir, "outside-tool")));
			const open = await shellHarness({ allow: [program] });
			try {
				const escape = join("..", relative(realpathSync(open.root), program));
				expect(refusal(await open.spawn({ program: escape })).code).toBe(
					"program-outside-root",
				);
				const id = await open.id({ program });
				expect((await open.settled(id)).stdout).toBe("pwned");
			} finally {
				await open.stop();
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a bare name PATH cannot see is not advertised as allowed", async () => {
		const open = await shellHarness({ allow: ["echo", "crust-no-such-program"] });
		try {
			const refused = refusal(await open.spawn({ program: "/bin/ls" }));
			expect(refused.message).toContain("allowed: echo");
			expect(refused.message).not.toContain("crust-no-such-program");
			expect(refusal(await open.spawn({ program: "crust-no-such-program" })).code).toBe(
				"spawn-failed",
			);
		} finally {
			await open.stop();
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
