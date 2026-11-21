/**
 * The children this process started and never owned, plus the one pass that reaps them.
 * A `Bun.spawn` child is not killed when its parent leaves: `app.quit()` ends in `process.exit(0)` and a
 * `crust dev` restart is `SIGTERM`, and neither path reaches a plugin's own live-child map. So a
 * `shell.spawn` program outlived every quit, and the next dev run started beside it.
 * The exit pass escalates straight to `SIGKILL`: `process.on("exit")` has no turn left to await a
 * signal, and `SIGKILL` is the only one a child cannot trap. `App.quit()` asks with `SIGTERM` first,
 * during the logger's asynchronous flush — a window the quit already pays for, never one added.
 */

/** The part of `Bun.Subprocess` a reap needs, so a test can hand over a stand-in. */
export interface TrackedChild {
	readonly pid: number;
	readonly exitCode: number | null;
	readonly signalCode: string | number | null;
	readonly exited?: Promise<number>;
	kill(signal?: string | number): unknown;
}

const live = new Set<TrackedChild>();
let installed = false;

const finished = (child: TrackedChild): boolean =>
	child.exitCode !== null || child.signalCode !== null;

/** Register a child so a quit or a signal reaps it; it leaves the set by itself once it exits. */
export function trackChild(child: TrackedChild): void {
	live.add(child);
	const gone = (): void => void live.delete(child);
	if (child.exited !== undefined) void child.exited.then(gone, gone);
}

/** How many tracked children have not exited; the suites assert a reap emptied it. */
export function liveChildren(): number {
	let count = 0;
	for (const child of live) if (!finished(child)) count++;
	return count;
}

/**
 * Signal every tracked child still running and answer how many were signalled.
 * A child that exited between its last check and this call is skipped rather than failing the pass,
 * because on the exit path nobody is left to receive the throw.
 */
export function reapChildren(signal: "SIGTERM" | "SIGKILL"): number {
	let signalled = 0;
	for (const child of live) {
		if (finished(child)) {
			live.delete(child);
			continue;
		}
		try {
			child.kill(signal);
			signalled++;
		} catch {
			// Already gone, or not ours to signal: the next pass sees it finished.
		}
	}
	return signalled;
}

/**
 * Install the reaps once per process: the exit listener that always runs, and a signal handler only
 * where nothing else owns the signal — `runtime-process.ts` already turns `SIGTERM`/`SIGINT` into
 * `process.exit(0)` for a real app, and a handler here that exited first would cut that path short.
 */
export function installReapOnExit(): void {
	if (installed) return;
	installed = true;
	process.on("exit", () => void reapChildren("SIGKILL"));
	for (const signal of ["SIGTERM", "SIGINT"] as const) {
		if (process.listenerCount(signal) > 0) continue;
		process.once(signal, () => {
			reapChildren("SIGKILL");
			process.exit(0);
		});
	}
}
