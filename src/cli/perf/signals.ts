/**
 * The recorder's exit trap. A signal handler cleans up, detaches itself, and only then re-raises so
 * the process dies by the signal's own disposition. Re-raising with the handler still installed
 * re-enters the cleanup until an external SIGKILL. Hooks are injected so a test can deliver a signal
 * without touching a real process.
 */

export const TRAP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
export type TrapSignal = (typeof TRAP_SIGNALS)[number];
export type TrapEvent = "exit" | TrapSignal;

export interface SignalHooks {
	/** Register a listener; the returned function unregisters exactly that listener. */
	on: (event: TrapEvent, fn: () => void) => () => void;
	die: (signal: TrapSignal) => void;
}

export const processSignalHooks: SignalHooks = {
	on: (event, fn) => {
		process.on(event, fn);
		return () => void process.removeListener(event, fn);
	},
	die: (signal) => void process.kill(process.pid, signal),
};

export function trapSignals(hooks: SignalHooks, cleanup: () => void) {
	let detached = false;
	const offs: Array<() => void> = [];
	offs.push(hooks.on("exit", cleanup));
	for (const signal of TRAP_SIGNALS) {
		offs.push(
			hooks.on(signal, () => {
				// Detach first: the re-raised signal must reach the default action, not this handler.
				detach();
				cleanup();
				hooks.die(signal);
			}),
		);
	}
	function detach(): void {
		if (detached) return;
		detached = true;
		for (const off of offs) off();
		offs.length = 0;
	}
	return { detach };
}
