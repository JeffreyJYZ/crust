/**
 * The lock's whole contract: whoever creates the file wins, a dead owner never
 * locks anyone out, and a refusal is an answer rather than a throw. Every test
 * uses a temp directory and a fake pid, so nothing here starts or raises a process.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isNotImplemented } from "./define";
import {
	createSingleInstancePlugin,
	type SingleInstanceAdapter,
	type SingleInstanceArgs,
} from "./single-instance";

/** A pid no process can have: macOS caps pids at 99998. */
const DEAD_PID = 999_999;
/** launchd, which is always alive and never ours — `kill(1, 0)` answers EPERM. */
const LIVE_FOREIGN_PID = 1;

const dirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "crust-single-"));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function pluginIn(dir: string, adapter?: SingleInstanceAdapter) {
	return createSingleInstancePlugin({ dir, adapter });
}

describe("the lock file", () => {
	test("acquire creates <dir>/<id>.lock holding this process's pid", () => {
		const dir = tempDir();
		const result = pluginIn(dir).commands.acquire({ id: "app" });

		expect(result.acquired).toBe(true);
		expect(result.pid).toBe(process.pid);
		expect(result.path).toBe(join(dir, "app.lock"));
		expect(readFileSync(result.path, "utf8").trim()).toBe(String(process.pid));
	});

	test("a second acquire in the same process is the same lock, not a refusal", () => {
		const dir = tempDir();
		const plugin = pluginIn(dir);

		expect(plugin.commands.acquire({ id: "app" }).acquired).toBe(true);
		const again = plugin.commands.acquire({ id: "app" });
		expect(again.acquired).toBe(true);
		expect(again.pid).toBe(process.pid);
	});

	test("a live foreign holder is refused with its pid, and its file is untouched", () => {
		const dir = tempDir();
		const path = join(dir, "app.lock");
		writeFileSync(path, `${LIVE_FOREIGN_PID}\n`);

		const result = pluginIn(dir).commands.acquire({ id: "app" });

		expect(result.acquired).toBe(false);
		expect(result.pid).toBe(LIVE_FOREIGN_PID);
		expect(readFileSync(result.path, "utf8").trim()).toBe(String(LIVE_FOREIGN_PID));
	});

	test("a lock naming a dead pid is stale and is taken over", () => {
		const dir = tempDir();
		writeFileSync(join(dir, "app.lock"), `${DEAD_PID}\n`);

		const result = pluginIn(dir).commands.acquire({ id: "app" });

		expect(result.acquired).toBe(true);
		expect(readFileSync(result.path, "utf8").trim()).toBe(String(process.pid));
	});

	test("a lock that names no pid at all is stale too", () => {
		const dir = tempDir();
		writeFileSync(join(dir, "app.lock"), "not-a-pid\n");

		expect(pluginIn(dir).commands.acquire({ id: "app" }).acquired).toBe(true);
	});

	test("release removes this process's lock, and a second release is an answer", () => {
		const dir = tempDir();
		const plugin = pluginIn(dir);
		const held = plugin.commands.acquire({ id: "app" });

		expect(plugin.commands.release({ id: "app" })).toEqual({
			released: true,
			path: held.path,
		});
		expect(existsSync(held.path)).toBe(false);
		expect(plugin.commands.release({ id: "app" }).released).toBe(false);
	});

	test("release refuses a live foreign lock and clears a stale one", () => {
		const dir = tempDir();
		const plugin = pluginIn(dir);
		const path = join(dir, "app.lock");

		writeFileSync(path, `${LIVE_FOREIGN_PID}\n`);
		const refused = plugin.commands.release({ id: "app" });
		expect(refused.released).toBe(false);
		expect(refused.pid).toBe(LIVE_FOREIGN_PID);
		expect(existsSync(path)).toBe(true);

		writeFileSync(path, `${DEAD_PID}\n`);
		expect(plugin.commands.release({ id: "app" }).released).toBe(true);
	});

	test("two ids in one directory are two locks", () => {
		const dir = tempDir();
		const plugin = pluginIn(dir);

		expect(plugin.commands.acquire({ id: "one" }).path).not.toBe(
			plugin.commands.acquire({ id: "two" }).path,
		);
	});
});

describe("arguments", () => {
	test("an id that could leave the lock directory is refused", () => {
		const plugin = pluginIn(tempDir());

		for (const id of ["", ".", "..", "../escape", "a/b", "a\\b"]) {
			expect(() => plugin.commands.acquire({ id })).toThrow(TypeError);
		}
	});

	test("a missing id is a TypeError, not a lock in the directory itself", () => {
		const plugin = pluginIn(tempDir());
		expect(() => plugin.commands.acquire({} as SingleInstanceArgs)).toThrow(TypeError);
	});

	test("activate refuses a pid that is not one", async () => {
		const plugin = pluginIn(tempDir());
		for (const pid of [0, -1, 1.5, Number.NaN]) {
			await expect(plugin.commands.activate({ pid })).rejects.toThrow(TypeError);
		}
	});
});

describe("activate", () => {
	test("with no adapter it answers NotImplemented instead of throwing", async () => {
		const result = await pluginIn(tempDir()).commands.activate({ pid: 4242 });
		expect(isNotImplemented(result)).toBe(true);
	});

	test("it reports the adapter's own status, never a guess", async () => {
		const raised = pluginIn(tempDir(), {
			activate: (pid) => ({ status: 0, reason: `raised ${pid}` }),
		});
		const taken = await raised.commands.activate({ pid: 4242 });
		if (isNotImplemented(taken)) throw new Error("expected an adapter answer");
		expect(taken.activated).toBe(true);
		expect(taken.reason).toBe("raised 4242");

		const refused = pluginIn(tempDir(), {
			activate: () => ({ status: 3, reason: "the system refused the activation" }),
		});
		const answer = await refused.commands.activate({ pid: 4242 });
		if (isNotImplemented(answer)) throw new Error("expected an adapter answer");
		expect(answer.activated).toBe(false);
		expect(answer.status).toBe(3);
	});
});

describe("the macOS adapter", () => {
	test.skipIf(process.platform !== "darwin")(
		"compiles, and reports a pid with no running application",
		async () => {
			const { darwinSingleInstanceAdapter, SINGLE_STATUS } =
				await import("../platform/darwin/single");
			const post = await darwinSingleInstanceAdapter().activate(DEAD_PID);
			expect(post.status).toBe(SINGLE_STATUS.noProcess);
		},
	);
});
