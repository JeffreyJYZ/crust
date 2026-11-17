/**
 * The shapes `crust:crash-reporter` answers with, kept apart from the handlers so each file stays
 * readable in one sitting. `crash-reporter.ts` owns the behaviour; nothing here runs.
 */

import type { StoredCrash } from "../runtime-crash-store";

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
	crash: StoredCrash | null;
	root: string;
}

export interface ListCrashesArgs {
	/** Keep only the most recent entries. */
	limit?: number;
}

export interface ListCrashesResult {
	/** Oldest first, the order they were appended. */
	crashes: StoredCrash[];
	root: string;
}

/** What a page caught: the ordinary case, where nothing faults the process. */
export interface ReportCrashArgs {
	message: string;
	stack?: string;
}

export interface ReportCrashResult {
	ok: true;
	/** The record as it was written, so the caller sees the truncation. */
	crash: StoredCrash;
	root: string;
}

/** Repoint where page reports land. A `url` is deliberately not accepted — see the guide. */
export interface ConfigureCrashArgs {
	dir?: string;
}

export interface ConfigureCrashResult {
	ok: true;
	/** The directory records are read from and written to from now on. */
	dir: string;
	root: string;
}

/** A directory outside the app's data root: named, not silently honoured. */
export interface ConfigureRefused {
	ok: false;
	code: "outside-data-root";
	message: string;
	root: string;
}

/** What the runtime's own `clearCrashes` would remove, were a page allowed to ask. */
export interface ClearCrashesResult {
	/** The paths that existed and are now gone. */
	cleared: string[];
	root: string;
}

/** What a page gets from `clear`: a named refusal, not a silent no-op. */
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
