/**
 * The guard's identity and its place on the quit path. A pid is not an identity: the guard must
 * know when the process it armed has gone, and `app.quit()` must be able to signal it.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { liveChildren } from "@/child-reap.ts";
import { guardTarget, startCrashGuard, watchCrashTarget } from "@/runtime-crash-guard.ts";

const roots: string[] = [];
const children: Subprocess[] = [];

async function tempDir(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "crust-guard-identity-"));
	roots.push(root);
	return root;
}

async function waitFor<T>(probe: () => T | null | undefined, timeoutMs = 3000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = probe();
		if (value !== null && value !== undefined) return value;
		if (Date.now() > deadline) throw new Error("timed out waiting for the guard");
		await Bun.sleep(20);
	}
}

afterEach(async () => {
	for (const child of children.splice(0)) {
		try {
			child.kill();
		} catch {
			// Already gone.
		}
	}
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("crash guard identity", () => {
	test("the launch token travels with the pid and root", () => {
		const target = guardTarget({
			CRUST_CRASH_GUARD: "42",
			CRUST_CRASH_GUARD_ROOT: "/tmp/root",
			CRUST_CRASH_GUARD_TOKEN: "token-abc",
		});
		expect(target?.token).toBe("token-abc");
	});

	test("a lost token ends the watch while the pid is still alive", async () => {
		const root = await tempDir();
		const token = "token-abc";
		await writeFile(join(root, "crash-guard.token"), token, { mode: 0o600 });
		const target = guardTarget({
			CRUST_CRASH_GUARD: String(process.pid),
			CRUST_CRASH_GUARD_ROOT: root,
			CRUST_CRASH_GUARD_TOKEN: token,
		});
		expect(target).not.toBeNull();
		const timer = setTimeout(
			() => void rm(join(root, "crash-guard.token"), { force: true }),
			150,
		);
		const outcome = await Promise.race([
			watchCrashTarget(target as NonNullable<typeof target>).then(() => "stopped"),
			Bun.sleep(1500).then(() => "timeout"),
		]);
		clearTimeout(timer);
		expect(outcome).toBe("stopped");
	});

	test("the guard is registered with the reaper so a quit can signal it", async () => {
		const root = await tempDir();
		const child = Bun.spawn({
			cmd: [process.execPath, "-e", "await Bun.sleep(30000)"],
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
		});
		children.push(child);
		const before = liveChildren();
		const guard = startCrashGuard({ appDataDir: root, pid: child.pid });
		expect(liveChildren()).toBe(before + 1);
		guard.stop();
		await waitFor(() => (liveChildren() <= before ? true : null));
	}, 15_000);
});
