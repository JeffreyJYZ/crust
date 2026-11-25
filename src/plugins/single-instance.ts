/**
 * `crust:single-instance` — one running copy per id, Tauri's `single-instance`. The lock is a file named after the id holding the owner's pid, created with `O_EXCL`, so the winner is whoever the filesystem says won; a lock naming a dead pid is stale and is taken over, which is why a crash never locks the user out. The file half — including the compare-and-delete that stops two waiters both winning a stale lock — lives in `single-instance-lock.ts`.
 * Raising the running copy needs a platform that can reach another process, so it arrives as an adapter exactly as `notification` does. A refused acquire is an answer, not a throw: `{ acquired: false, pid }` is the pid to activate, and only a malformed argument throws.
 */

import {
	acquire,
	type AcquireResult,
	type BeforeTakeover,
	checkPid,
	defaultLockDir,
	release,
	type ReleaseResult,
} from "./single-instance-lock.ts";
import { definePlugin, notImplemented, type NotImplemented, type PluginDefinition } from "./define";

export {
	type AcquireResult,
	defaultLockDir,
	MAX_PID,
	type ReleaseResult,
} from "./single-instance-lock.ts";

export interface SingleInstanceArgs {
	/** The lock's name: an app id, and a single file-name token. */
	id: string;
}

/** Only the status that means the system took the activation. */
const ACTIVATED_STATUS = 0;

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
	/** Test seam: forces a competing waiter to replace a stale lock mid-acquire. */
	beforeTakeover?: BeforeTakeover;
	/** Test seam: fires after the takeover reads the stale bytes, before it drops them. */
	duringTakeover?: BeforeTakeover;
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
			acquire: (args: SingleInstanceArgs) =>
				acquire(dir, args?.id, options.beforeTakeover, options.duringTakeover),
			release: (args: SingleInstanceArgs) => release(dir, args?.id),
			activate: (args: ActivateArgs) => activate(options.adapter, args?.pid),
		},
	});
}

/** The default registration: the lock works, `activate` is honest about the missing adapter. */
export const singleInstancePlugin = createSingleInstancePlugin();
