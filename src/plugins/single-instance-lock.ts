/**
 * `crust:single-instance`'s lock file: O_EXCL creation, stale-pid takeover and
 * release, kept apart from the plugin contract so the takeover race is readable
 * on its own. A takeover never unlinks a lock whose bytes changed since they
 * were read — a competing waiter may have replaced a stale lock with its own
 * live one in between, and deleting that would let both processes believe they won.
 */

import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** No larger pid can exist, and the API behind `activate` takes an int. */
export const MAX_PID = 2_147_483_647;

export interface AcquireResult {
	acquired: boolean;
	pid: number; // this process when acquired, else the live holder, 0 when the file names no readable pid
	path: string;
}

export interface ReleaseResult {
	released: boolean;
	path: string;
	pid?: number; // the live process still holding it, when the release was refused
}

/** The app-support directory the locks live in; one file per id. */
export function defaultLockDir(): string {
	const base =
		process.platform === "darwin"
			? join(homedir(), "Library", "Application Support")
			: (process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"));
	return join(base, "crust", "single-instance");
}

function codeOf(error: unknown): string | undefined {
	const code = (error as { code?: unknown } | null | undefined)?.code;
	return code === undefined ? undefined : String(code);
}

/** An id becomes a file name, so a separator would escape the lock directory. */
export function lockPath(dir: string, id: unknown): string {
	if (typeof id !== "string" || id.length === 0) {
		throw new TypeError('single-instance: "id" must be a non-empty string');
	}
	if (id === "." || id === ".." || id.includes("/") || id.includes("\\")) {
		throw new TypeError(`single-instance: id "${id}" must be a single file-name token`);
	}
	return join(dir, `${id}.lock`);
}

export function checkPid(pid: unknown): number {
	if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0 || pid > MAX_PID) {
		throw new TypeError(`single-instance: "pid" must be an integer in 1..${MAX_PID}`);
	}
	return pid;
}

function parsePid(raw: string): number | undefined {
	const pid = Number.parseInt(raw.trim(), 10);
	return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

/** The lock's exact bytes plus the pid they name, or nothing when it is gone. */
function readLock(path: string): { pid: number | undefined; raw: string } | undefined {
	try {
		const raw = readFileSync(path, "utf8");
		return { pid: parsePid(raw), raw };
	} catch {
		return undefined;
	}
}

/** `kill(pid, 0)` is the liveness probe: ESRCH means gone, EPERM means alive but not ours. */
function isAlive(pid: number): boolean {
	if (pid === process.pid) return true;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return codeOf(error) === "EPERM";
	}
}

/** `O_EXCL` by name: `wx` fails `EEXIST` when any file is already there, even an empty one. */
function take(path: string): boolean {
	try {
		writeFileSync(path, `${process.pid}\n`, { flag: "wx", mode: 0o644 });
		return true;
	} catch (error) {
		if (codeOf(error) === "EEXIST") return false;
		throw error;
	}
}

function drop(path: string): boolean {
	try {
		unlinkSync(path);
		return true;
	} catch (error) {
		if (codeOf(error) === "ENOENT") return false;
		throw error;
	}
}

/**
 * Atomic compare-and-delete. Read-then-unlink cannot be made safe by reordering: a competing
 * waiter can replace the stale lock between the two syscalls, and the unlink then removes *its*
 * fresh lock. Instead the file is hard-linked to a private name first. `link` is one atomic
 * syscall, so the private name and the lock name point at the same inode from that instant. The
 * bytes are read through the private name, and the link count decides the winner: `nlink === 2`
 * means only our private name and the lock name still name that inode, so nobody else replaced it.
 * A second waiter that linked the same inode raises the count to 3 and both back off; the acquire
 * loop then retries against whatever is on disk. If the lock was already replaced, our private
 * link names the old inode, its bytes still match, but `nlink === 1`, so we leave the new file be.
 */
export function dropIfUnchanged(
	path: string,
	raw: string,
	duringTakeover?: BeforeTakeover,
): boolean {
	const claim = `${path}.${process.pid}.${randomUUID()}.claim`;
	try {
		linkSync(path, claim);
	} catch (error) {
		if (codeOf(error) === "ENOENT") return false;
		throw error;
	}
	try {
		if (readFileSync(claim, "utf8") !== raw) return false;
		// Test seam: the exact window a plain compare-and-unlink could not survive.
		duringTakeover?.(path);
		if (statSync(claim).nlink !== 2) return false;
		try {
			unlinkSync(path);
		} catch (error) {
			if (codeOf(error) === "ENOENT") return false;
			throw error;
		}
		return true;
	} finally {
		try {
			unlinkSync(claim);
		} catch {
			// Best effort: the claim is a private hard link, never the lock itself.
		}
	}
}

/** Test seam: forces a competing waiter to replace the stale lock mid-acquire. */
export type BeforeTakeover = (path: string) => void;

export function acquire(
	dir: string,
	rawId: unknown,
	beforeTakeover?: BeforeTakeover,
	duringTakeover?: BeforeTakeover,
): AcquireResult {
	const path = lockPath(dir, rawId);
	mkdirSync(dir, { recursive: true });
	// Re-check on every attempt: a stale lock is replaced, not assumed gone.
	// `dropIfUnchanged` never removes a fresh lock another waiter just wrote.
	for (let attempt = 0; attempt < 3; attempt++) {
		if (take(path)) return { acquired: true, pid: process.pid, path };
		const lock = readLock(path);
		if (lock === undefined) continue; // vanished between the take and the read
		const holder = lock.pid;
		if (holder === process.pid) return { acquired: true, pid: holder, path };
		if (holder !== undefined && isAlive(holder)) return { acquired: false, pid: holder, path };
		beforeTakeover?.(path);
		dropIfUnchanged(path, lock.raw, duringTakeover);
	}
	return { acquired: false, pid: readLock(path)?.pid ?? 0, path };
}

export function release(dir: string, rawId: unknown): ReleaseResult {
	const path = lockPath(dir, rawId);
	const holder = readLock(path)?.pid;
	// Only a live foreign holder keeps its lock; a stale one is the same dead
	// process `acquire` would take over, so releasing it is not theft.
	if (holder !== undefined && holder !== process.pid && isAlive(holder)) {
		return { released: false, path, pid: holder };
	}
	return { released: drop(path), path };
}
