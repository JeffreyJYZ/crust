/**
 * The launch-time half of `crust:single-instance`: `startApp` claims the app id's lock before the platform exists, so a second launch raises the copy already running and never builds AppKit, imports the entry, or opens a window. The lock, the stale takeover and the raise all live in `plugins/single-instance.ts`; this module is only the launch order plus the two decisions the runtime owns — when the check is off, and what a refused launch does.
 * Opt-out is `CRUST_SINGLE_INSTANCE=0`. There is no natural config flag: the config has no `singleInstance` key, and `plugins` names what the page may call, not what the process may lock, so no key was added.
 */

import type { CrustConfig } from "@/config";
import { isNotImplemented, notImplemented, type NotImplemented } from "@/plugins/define";
import {
	createSingleInstancePlugin,
	type ActivateResult,
	type SingleInstanceAdapter,
} from "@/plugins/single-instance";

/** The variable a launch reads to turn the lock off. */
export const SINGLE_INSTANCE_VAR = "CRUST_SINGLE_INSTANCE";

/** The plugin as `createSingleInstancePlugin` builds it, so the claim hands back the same instance the page reaches. */
export type SingleInstancePlugin = ReturnType<typeof createSingleInstancePlugin>;

/** Why a launch did not take the lock; `undefined` means it did. */
export type SkipReason = "disabled" | "headless" | "unsupported";

export interface ClaimOptions {
	config: CrustConfig;
	/** False for a headless bridge: nothing opens a window, so nothing may lock. */
	attachPlatform?: boolean;
	/** Tests pass their own; the runtime gets `darwinSingleInstanceAdapter()`. */
	adapter?: SingleInstanceAdapter;
	/** Where the lock files live; defaults to the app-support directory. */
	dir?: string;
	env?: Record<string, string | undefined>;
	platform?: string;
}

export interface SingleInstanceClaim {
	/** True when this process owns the lock, or when the check was skipped. */
	acquired: boolean;
	skipped?: SkipReason;
	/** This process when acquired, else the live holder to raise. */
	pid: number;
	/** The registered plugin, so the page reaches the same lock and adapter. */
	plugin: SingleInstancePlugin;
	/** Remove this process's lock. A no-op when skipped. */
	release(): void;
	/** Raise the holder that refused this launch. */
	activate(): Promise<ActivateResult | NotImplemented>;
}

/**
 * Locks this process still owes a release for, by path. One `exit` hook drains
 * them: `process.exit` runs it, and so does the SIGINT/SIGTERM handler, while a
 * SIGKILL leaves a stale pid the next launch takes over.
 */
const pending = new Map<string, () => void>();
let exitHooked = false;

function onExit(path: string, release: () => void): void {
	pending.set(path, release);
	if (exitHooked) return;
	exitHooked = true;
	process.once("exit", () => {
		for (const release of pending.values()) release();
		pending.clear();
	});
}

/**
 * An app id becomes a file name, and a separator would escape the lock
 * directory, so anything outside the token set is folded to `_`.
 */
export function lockName(id: unknown): string {
	const token = String(id ?? "").replace(/[^A-Za-z0-9._-]/g, "_");
	return token === "" || token === "." || token === ".." ? "crust-app" : token;
}

function skipReason(
	attachPlatform: boolean,
	env: Record<string, string | undefined>,
	platform: string,
): SkipReason | undefined {
	if (env[SINGLE_INSTANCE_VAR] === "0") return "disabled";
	if (!attachPlatform) return "headless";
	// Without an adapter a refusal could not raise the running copy, so locking
	// would only lock the user out.
	if (platform !== "darwin") return "unsupported";
	return undefined;
}

/**
 * Take the lock on the app id, or report the live holder to raise. Called from
 * `startApp` before the platform is built, so a refused launch does nothing at
 * all beyond raising the first copy.
 */
export async function claimSingleInstance(options: ClaimOptions): Promise<SingleInstanceClaim> {
	const env = options.env ?? process.env;
	const platform = options.platform ?? process.platform;
	const attachPlatform = options.attachPlatform !== false;
	const adapter =
		options.adapter ??
		(platform === "darwin"
			? (await import("@/platform/darwin/single")).darwinSingleInstanceAdapter()
			: undefined);
	const plugin = createSingleInstancePlugin({ adapter, dir: options.dir });
	const skipped = skipReason(attachPlatform, env, platform);
	if (skipped !== undefined) {
		return {
			acquired: true,
			skipped,
			pid: process.pid,
			plugin,
			release: () => {},
			// Nothing was refused, so nothing is raised.
			activate: async () =>
				notImplemented(
					`single-instance is off for this launch (${skipped}), so there is no running copy to raise.`,
					"single-instance",
				),
		};
	}
	const id = lockName(options.config.app.id);
	const held = plugin.commands.acquire({ id });
	const release = (): void => {
		pending.delete(held.path);
		plugin.commands.release({ id });
	};
	if (held.acquired) onExit(held.path, release);
	return {
		acquired: held.acquired,
		pid: held.pid,
		plugin,
		release,
		activate: () => plugin.commands.activate({ pid: held.pid }),
	};
}

export interface QuitOptions {
	/** The plugin's `activate`, injected so a test raises nothing real. */
	activate: () => Promise<ActivateResult | NotImplemented>;
	/** Where the one line goes; `console.log` by default. */
	report?: (line: string) => void;
}

/**
 * What a refused launch does: raise the copy that holds the lock and say so. It
 * exits nothing itself — `startApp` ends the process after this returns, which
 * keeps the whole path callable in a test with no AppKit and no window.
 */
export async function quitSecondInstance(pid: number, options: QuitOptions): Promise<void> {
	const result = await options.activate();
	const line = isNotImplemented(result)
		? `another instance holds the lock (pid ${pid}) and this build cannot raise it`
		: result.activated
			? `raised the running instance (pid ${pid})`
			: `another instance holds the lock (pid ${pid}); raising it failed: ${result.reason}`;
	(options.report ?? console.log)(`  single    ${line}`);
}
