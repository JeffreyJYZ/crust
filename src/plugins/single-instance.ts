/**
 * `crust:single-instance` — one running copy per id, Tauri's `single-instance`. The lock is a file named after the id holding the owner's pid, created with `O_EXCL`, so the winner is whoever the filesystem says won; a lock naming a dead pid is stale and is taken over, which is why a crash never locks the user out.
 * Raising the running copy needs a platform that can reach another process, so it arrives as an adapter exactly as `notification` does. A refused acquire is an answer, not a throw: `{ acquired: false, pid }` is the pid to activate, and only a malformed argument throws.
 */

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { definePlugin, notImplemented, type NotImplemented, type PluginDefinition } from "./define";

/** No larger pid can exist, and the API behind `activate` takes an int. */
const MAX_PID = 2_147_483_647;
/** The only status that means the system took the activation. */
const ACTIVATED_STATUS = 0;

export interface SingleInstanceArgs {
	/** The lock's name: an app id, and a single file-name token. */
	id: string;
}

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

export interface ActivateArgs {
	pid: number;
}

/** What an adapter reports: `status` 0 is the only activated value. */
export interface ActivatePost {
	status: number;
	reason: string;
}

/** What `activate` answers. `activated` is the system's word, not the adapter's optimism. */
export interface ActivateResult {
	activated: boolean;
	status: number;
	reason: string;
}

/**
 * The native half of `crust:single-instance`: raise the process that already holds the lock, through `NSRunningApplication` in `platform/darwin/single.ts`.
 */
export interface SingleInstanceAdapter {
	activate(pid: number): ActivatePost | Promise<ActivatePost>;
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
function lockPath(dir: string, id: unknown): string {
	if (typeof id !== "string" || id.length === 0) {
		throw new TypeError('single-instance: "id" must be a non-empty string');
	}
	if (id === "." || id === ".." || id.includes("/") || id.includes("\\")) {
		throw new TypeError(`single-instance: id "${id}" must be a single file-name token`);
	}
	return join(dir, `${id}.lock`);
}

function checkPid(pid: unknown): number {
	if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0 || pid > MAX_PID) {
		throw new TypeError(`single-instance: "pid" must be an integer in 1..${MAX_PID}`);
	}
	return pid;
}

/** The pid a lock names, or nothing when the file is missing, empty or not a pid. */
function readPid(path: string): number | undefined {
	try {
		const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
		return Number.isInteger(pid) && pid > 0 ? pid : undefined;
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

function acquire(dir: string, rawId: unknown): AcquireResult {
	const path = lockPath(dir, rawId);
	mkdirSync(dir, { recursive: true });
	// Two attempts: the second races for a lock just proved stale, so two waiters cannot both read a dead pid and both unlink it.
	for (let attempt = 0; attempt < 2; attempt++) {
		if (take(path)) return { acquired: true, pid: process.pid, path };
		const holder = readPid(path);
		if (holder === process.pid) return { acquired: true, pid: holder, path };
		if (holder !== undefined && isAlive(holder)) return { acquired: false, pid: holder, path };
		drop(path);
	}
	return { acquired: false, pid: readPid(path) ?? 0, path };
}

function release(dir: string, rawId: unknown): ReleaseResult {
	const path = lockPath(dir, rawId);
	const holder = readPid(path);
	// Only a live foreign holder keeps its lock; a stale one is the same dead
	// process `acquire` would take over, so releasing it is not theft.
	if (holder !== undefined && holder !== process.pid && isAlive(holder)) {
		return { released: false, path, pid: holder };
	}
	return { released: drop(path), path };
}

async function activate(
	adapter: SingleInstanceAdapter | undefined,
	rawPid: unknown,
): Promise<ActivateResult | NotImplemented> {
	const pid = checkPid(rawPid);
	if (!adapter) {
		return notImplemented(
			"single-instance.activate needs a platform that can raise another process: pass a SingleInstanceAdapter to createSingleInstancePlugin, since macOS answers through NSRunningApplication -activateWithOptions: and there is no portable equivalent.",
			"NSRunningApplication",
		);
	}
	const post = await adapter.activate(pid);
	return {
		activated: post.status === ACTIVATED_STATUS,
		status: post.status,
		reason: post.reason,
	};
}

export interface SingleInstanceOptions {
	dir?: string; // where the lock files live; tests pass a temp one, the app support dir is the default
	adapter?: SingleInstanceAdapter;
}

export function createSingleInstancePlugin(options: SingleInstanceOptions = {}): PluginDefinition<
	"single-instance",
	{
		acquire: (args: SingleInstanceArgs) => AcquireResult;
		release: (args: SingleInstanceArgs) => ReleaseResult;
		activate: (args: ActivateArgs) => Promise<ActivateResult | NotImplemented>;
	}
> {
	const dir = options.dir ?? defaultLockDir();
	return definePlugin({
		name: "single-instance",
		commands: {
			acquire: (args: SingleInstanceArgs) => acquire(dir, args?.id),
			release: (args: SingleInstanceArgs) => release(dir, args?.id),
			activate: (args: ActivateArgs) => activate(options.adapter, args?.pid),
		},
	});
}

/** The default registration: the lock works, `activate` is honest about the missing adapter. */
export const singleInstancePlugin = createSingleInstancePlugin();
