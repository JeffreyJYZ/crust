/**
 * `crust:crash-reporter` — what the app knows about its own last crash. The reporting itself happens in a second process (`runtime-crash-guard.ts`), so every command here reads a file or arms a handler; none of them can run inside a process that is already faulting.
 * The rule this file enforces: **a guard that was never started is named, not papered over.** Without it nothing ever writes a record, so `last`, `list` and `clear` answer a typed `NotImplemented` naming `startCrashGuard()` instead of an empty list that reads like "no crashes".
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { crashRecordPath, type CrashRecord } from "../platform/darwin/crash-record";
import { listCrashes, readLastCrash } from "../runtime-crash-store";
import { definePlugin, notImplemented, type NotImplemented, type PluginDefinition } from "./define";

/** What the native half reports for one arm or disarm; `platform/darwin/crash.ts` owns the status set. */
export interface CrashArmResult {
	armed: boolean;
	status: number;
	reason: string;
}

/** The signal half, injected so a test never installs a real handler in its own process. */
export interface CrashNative {
	arm(recordPath: string): CrashArmResult;
	disarm(): CrashArmResult;
}

/** The guard, as the plugin needs it: present only once `startCrashGuard()` returned. */
export interface CrashGuardState {
	running(): boolean;
}

export interface CrashReporterOptions {
	/** The app's data directory; defaults to `~/Library/Application Support/<appId ?? "crust">`. */
	root?: string;
	appId?: string;
	home?: string;
	guard?: CrashGuardState;
	native?: CrashNative;
}

export interface LastCrashResult {
	/** Null when the guard is running and nothing has crashed. */
	crash: CrashRecord | null;
	root: string;
}

export interface ListCrashesArgs {
	/** Keep only the most recent entries. */
	limit?: number;
}

export interface ListCrashesResult {
	/** Oldest first, the order they were appended. */
	crashes: CrashRecord[];
	root: string;
}

export interface ClearCrashesResult {
	/** The paths that existed and are now gone. */
	cleared: string[];
	root: string;
}

/**
 * What a page gets from `clear`: a named refusal, not a silent no-op. The page is the process whose
 * bug produced the crash, so it is the last caller that may delete the record of it.
 */
export interface ClearRefused {
	ok: false;
	code: "page-cannot-clear";
	message: string;
	root: string;
}

export interface InstallResult {
	armed: boolean;
	reason: string;
	/** The record the handlers write. */
	record: string;
	root: string;
}

export interface UninstallResult {
	/** True when handlers are still installed: the native disarm did not take effect. */
	armed: boolean;
	/** The native status, so a refused disarm names the step that said no. */
	status: number;
	reason: string;
}

/** The one message every guard-less command answers, so the missing half is named once. */
const NO_GUARD = "crash-reporter: the helper process is not running";

export function createCrashReporterPlugin(options: CrashReporterOptions = {}): PluginDefinition<
	"crash-reporter",
	{
		last: () => LastCrashResult | NotImplemented;
		list: (args?: ListCrashesArgs) => ListCrashesResult | NotImplemented;
		clear: () => ClearRefused | NotImplemented;
		install: () => InstallResult | NotImplemented;
		uninstall: () => UninstallResult | NotImplemented;
	}
> {
	const root =
		options.root ??
		join(options.home ?? homedir(), "Library", "Application Support", options.appId ?? "crust");
	const native = options.native;
	const guardRunning = (): boolean => options.guard?.running() === true;
	const noGuard = (): NotImplemented => notImplemented(NO_GUARD, "startCrashGuard()");
	const noNative = (command: string): NotImplemented =>
		notImplemented(
			`crash-reporter.${command} needs the darwin signal unit: only that half can install a handler that survives a fault. Pass a CrashNative to createCrashReporterPlugin on a platform without it.`,
			"armCrashHandlers()",
		);

	return definePlugin({
		name: "crash-reporter",
		commands: {
			/** The newest crash the guard recorded. */
			last: (): LastCrashResult | NotImplemented => {
				if (!guardRunning()) return noGuard();
				return { crash: readLastCrash(root), root };
			},
			/** Every recorded crash, oldest first. */
			list: (args?: ListCrashesArgs): ListCrashesResult | NotImplemented => {
				if (!guardRunning()) return noGuard();
				return { crashes: listCrashes(root, args?.limit), root };
			},
			/**
			 * Refused from the page. Deleting the evidence is a runtime decision: the runtime calls
			 * `clearCrashes(root)` from `runtime-crash-store.ts`, which is the only caller allowed to.
			 */
			clear: (): ClearRefused | NotImplemented => {
				if (!guardRunning()) return noGuard();
				return {
					ok: false,
					code: "page-cannot-clear",
					message: `crash-reporter.clear: a page cannot delete its own crash evidence; the runtime calls clearCrashes(${root}) instead`,
					root,
				};
			},
			/** Arm the handlers, so the next fault writes a record the guard can read. */
			install: (): InstallResult | NotImplemented => {
				if (!guardRunning()) return noGuard();
				if (!native) return noNative("install");
				const record = crashRecordPath(root);
				const arm = native.arm(record);
				return { armed: arm.armed, reason: arm.reason, record, root };
			},
			/** Restore the default disposition, so a fault is a plain fault again. */
			uninstall: (): UninstallResult | NotImplemented => {
				if (!guardRunning()) return noGuard();
				if (!native) return noNative("uninstall");
				const arm = native.disarm();
				return { armed: arm.armed, status: arm.status, reason: arm.reason };
			},
		},
	});
}

/** The default registration: honest about the guard nobody started. */
export const crashReporterPlugin = createCrashReporterPlugin();
