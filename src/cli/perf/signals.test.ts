import { describe, expect, test } from "bun:test";
import { trapSignals, type SignalHooks } from "./signals.ts";

/** A process stand-in: delivery only reaches listeners still registered, like the OS. */
function fakeHost() {
	const listeners = new Map<string, Set<() => void>>();
	const kills: string[] = [];
	const hooks: SignalHooks = {
		on(event, fn) {
			const set = listeners.get(event) ?? new Set<() => void>();
			set.add(fn);
			listeners.set(event, set);
			return () => void set.delete(fn);
		},
		die(signal) {
			kills.push(signal);
		},
	};
	const emit = (event: string): void => {
		for (const fn of [...(listeners.get(event) ?? [])]) fn();
	};
	return { hooks, kills, emit };
}

describe("recorder signal trap", () => {
	test("a signal is re-raised once, after its own handler is detached", () => {
		const host = fakeHost();
		let cleanups = 0;
		trapSignals(host.hooks, () => {
			cleanups += 1;
		});
		host.emit("SIGINT");
		expect(host.kills).toEqual(["SIGINT"]);
		expect(cleanups).toBe(1);
		// A second delivery must find no handler from this trap to re-enter.
		host.emit("SIGINT");
		expect(host.kills).toEqual(["SIGINT"]);
		expect(cleanups).toBe(1);
	});

	test("detach leaves another module's signal handler registered", () => {
		const host = fakeHost();
		let foreign = 0;
		host.hooks.on("SIGTERM", () => {
			foreign += 1;
		});
		trapSignals(host.hooks, () => {}).detach();
		host.emit("SIGTERM");
		expect(foreign).toBe(1);
		expect(host.kills).toEqual([]);
	});
});
