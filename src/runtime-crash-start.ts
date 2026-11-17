/**
 * The launch half of crash reporting: start the guard, arm the handlers, and name any failure.
 * Split out of `runtime-plugins.ts` because both rules cost a bug — a swallowed spawn failure left
 * an empty crash feature with no clue why, and the handlers were only ever armed by a page's
 * `crash-reporter.install`, so an app that never called it recorded nothing when it crashed.
 *
 * Everything native is injected: this file owns the order and the reporting, not AppKit.
 */

/** The guard, as much of it as this file needs. */
export interface GuardHandle {
	running(): boolean;
}

/** The darwin signal unit, as `platform/darwin/crash.ts` hands it back. */
export interface CrashNative {
	arm(recordPath: string): { armed: boolean; reason: string };
	disarm(): { armed: boolean; reason: string };
}

export interface CrashPartOptions {
	/** The app's data directory: the record, the log and `last-crash.json` live directly in it. */
	root: string;
	/** Where the record goes; `crashRecordPath(root)` unless a test says otherwise. */
	record: string;
	/** `startCrashGuard`; injected so a test never spawns a process. */
	start(options: { appDataDir: string }): GuardHandle;
	/** The darwin signal unit. */
	native: CrashNative;
	/** Where a failure is named; `console.warn` unless a test captures it. */
	warn?(line: string): void;
}

export interface CrashPart {
	/** Absent when the guard could not be spawned, which every crash command then reports. */
	guard: GuardHandle | undefined;
	/** True only when the signal handlers are installed after this call. */
	armed: boolean;
}

/**
 * Start the guard and arm the handlers at launch. A guard that will not spawn is named in one
 * warning and left absent, so `crash-reporter` answers its own `not-implemented` instead of the
 * launch dying before a window exists. A guard that spawned but would not arm is named too, because
 * a record nothing writes is the same empty feature.
 */
export function startCrashPart(options: CrashPartOptions): CrashPart {
	const warn = options.warn ?? ((line: string) => console.warn(line));
	let guard: GuardHandle;
	try {
		guard = options.start({ appDataDir: options.root });
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		warn(`  crash     the guard did not start, crash records are off: ${reason}`);
		return { guard: undefined, armed: false };
	}
	// A guard that already exited writes nothing, so arming would only promise a record.
	if (guard.running() !== true) return { guard, armed: false };
	const armed = options.native.arm(options.record);
	if (!armed.armed) warn(`  crash     handlers did not arm: ${armed.reason}`);
	return { guard, armed: armed.armed };
}
