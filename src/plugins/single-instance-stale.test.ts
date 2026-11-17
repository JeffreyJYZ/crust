/**
 * The stale-lock takeover race. After reading a dead pid, two waiters used to
 * both unconditionally unlink the lock; a fresh lock written by one was then
 * removed by the other, and both reported `acquired: true`. The takeover is now
 * compare-and-delete, and the test seam forces the exact interleave.
 */

import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSingleInstancePlugin } from "./single-instance.ts";
import { dropIfUnchanged } from "./single-instance-lock.ts";

const DEAD_PID = 999_999;
const LIVE_FOREIGN_PID = 1;

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "crust-single-race-"));
	dirs.push(dir);
	return dir;
}

test("a competing waiter's fresh lock is not unlinked during stale takeover", () => {
	const dir = tempDir();
	const path = join(dir, "app.lock");
	writeFileSync(path, `${DEAD_PID}\n`);
	let fired = false;
	const plugin = createSingleInstancePlugin({
		dir,
		beforeTakeover: () => {
			if (fired) return;
			fired = true;
			// Another waiter replaced the stale lock with its own live one here.
			writeFileSync(path, `${LIVE_FOREIGN_PID}\n`);
		},
	});

	const result = plugin.commands.acquire({ id: "app" });
	expect(fired).toBe(true);
	expect(result.acquired).toBe(false);
	expect(result.pid).toBe(LIVE_FOREIGN_PID);
	expect(readFileSync(path, "utf8").trim()).toBe(String(LIVE_FOREIGN_PID));
});

test("dropIfUnchanged removes only the exact bytes it was given", () => {
	const path = join(tempDir(), "app.lock");
	writeFileSync(path, `${DEAD_PID}\n`);
	const stale = readFileSync(path, "utf8");
	writeFileSync(path, `${LIVE_FOREIGN_PID}\n`);

	expect(dropIfUnchanged(path, stale)).toBe(false);
	expect(existsSync(path)).toBe(true);
	const fresh = readFileSync(path, "utf8");
	expect(dropIfUnchanged(path, fresh)).toBe(true);
	expect(existsSync(path)).toBe(false);
});
