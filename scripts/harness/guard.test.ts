/**
 * The guard's behaviour, asserted without touching the screen: the command runner and the process
 * wiring are both injected, so a test fires `exit` or a signal by calling the recorded listener and
 * never signals its own runner. Every probe here is replayed, never spawned.
 */
import { expect, test } from "bun:test";
import {
	GUARD_SIGNALS,
	type GuardEvent,
	type GuardHooks,
	type SyncRunner,
	makeGuard,
} from "./guard.ts";

interface Probe {
	name?: string;
	path?: string;
	windows?: string;
	nameCode?: number;
	pathCode?: number;
	windowsCode?: number;
}

/** A runner that answers by which AppleScript was asked, and records every command. */
function probe(options: Probe) {
	const calls: string[][] = [];
	const run: SyncRunner = (command) => {
		calls.push(command);
		if (command[0] === "open") return { code: 0, stdout: "" };
		const script = command[2] ?? "";
		if (script.includes("frontmost is true"))
			return { code: options.nameCode ?? 0, stdout: options.name ?? "" };
		if (script.includes("POSIX path"))
			return { code: options.pathCode ?? 0, stdout: options.path ?? "" };
		if (script.includes("count windows"))
			return { code: options.windowsCode ?? 0, stdout: options.windows ?? "1" };
		return { code: 1, stdout: "" };
	};
	return {
		run,
		calls,
		osascripts: () => calls.filter((command) => command[0] === "osascript"),
		opens: () => calls.filter((command) => command[0] === "open").map((command) => command[2]),
	};
}

/** Process wiring that records handlers, so a test fires them instead of signalling itself. */
function wiring() {
	const listeners = new Map<GuardEvent, Array<() => void>>();
	const died: string[] = [];
	const notes: string[] = [];
	const hooks: GuardHooks = {
		on: (event, listener) => {
			const list = listeners.get(event) ?? [];
			list.push(listener);
			listeners.set(event, list);
			return () => {
				const index = list.indexOf(listener);
				if (index >= 0) list.splice(index, 1);
			};
		},
		die: (signal) => void died.push(signal),
	};
	return {
		hooks,
		died,
		notes,
		write: (line: string) => void notes.push(line),
		count: (event: GuardEvent) => (listeners.get(event) ?? []).length,
		fire: (event: GuardEvent) => {
			for (const listener of [...(listeners.get(event) ?? [])]) listener();
		},
	};
}

const brave = { name: "Brave", path: "/Applications/Brave.app" };

test("guardFocus captures once and arms exit plus the three signals", () => {
	const target = probe(brave);
	const { hooks, write, count } = wiring();
	const { guardFocus } = makeGuard({ run: target.run, platform: "darwin", hooks, write });
	expect(guardFocus()).toBe("Brave");
	expect(guardFocus()).toBe("Brave");
	expect(target.osascripts()).toHaveLength(3);
	expect(count("exit")).toBe(1);
	expect(count("SIGINT")).toBe(1);
	expect(count("SIGTERM")).toBe(1);
	expect(count("SIGHUP")).toBe(1);
});

test("exit restores the captured app synchronously, and only once", () => {
	const target = probe(brave);
	const { hooks, write, fire } = wiring();
	makeGuard({ run: target.run, platform: "darwin", hooks, write }).guardFocus();
	fire("exit");
	expect(target.opens()).toEqual(["Brave"]);
	fire("exit");
	expect(target.opens()).toEqual(["Brave"]);
});

test("each signal restores, disarms itself and re-raises that signal", () => {
	for (const signal of GUARD_SIGNALS) {
		const target = probe(brave);
		const { hooks, write, fire, died, count } = wiring();
		makeGuard({ run: target.run, platform: "darwin", hooks, write }).guardFocus();
		fire(signal);
		expect(target.opens()).toEqual(["Brave"]);
		expect(died).toEqual([signal]);
		expect(count(signal)).toBe(0);
		fire("exit");
		expect(target.opens()).toEqual(["Brave"]);
	}
});

test("a captured crust-e2e app is refused, and the fallback is said once", () => {
	const target = probe({ name: "crust-e2e-notes-abc", path: "/Applications/Notes.app" });
	const { hooks, write, fire, notes } = wiring();
	const { guardFocus } = makeGuard({ run: target.run, platform: "darwin", hooks, write });
	expect(guardFocus()).toBe("Ghostty");
	expect(guardFocus()).toBe("Ghostty");
	expect(notes).toHaveLength(1);
	expect(notes[0]).toContain("crust-e2e-notes-abc");
	expect(notes[0]).toContain("Ghostty");
	fire("exit");
	expect(target.opens()).toEqual(["Ghostty"]);
});

test("an app running from a scratch path is refused", () => {
	const target = probe({
		name: "Hello crust",
		path: "/var/folders/mv/T/crust-e2e-notes-1/dist/Hello crust.app",
	});
	const { hooks, write } = wiring();
	const { guardFocus } = makeGuard({ run: target.run, platform: "darwin", hooks, write });
	expect(guardFocus()).toBe("Ghostty");
});

test("a process with no window is refused", () => {
	const target = probe({ ...brave, windows: "0" });
	const { hooks, write } = wiring();
	const { guardFocus } = makeGuard({ run: target.run, platform: "darwin", hooks, write });
	expect(guardFocus()).toBe("Ghostty");
});

test("an unreadable probe never refuses the human's own app", () => {
	const target = probe({ ...brave, pathCode: 1, windowsCode: 1 });
	const { hooks, write } = wiring();
	const { guardFocus } = makeGuard({ run: target.run, platform: "darwin", hooks, write });
	expect(guardFocus()).toBe("Brave");
});

test("a configured default is what a refusal restores", () => {
	const target = probe({ name: "crust-e2e-x", path: "/Applications/X.app" });
	const { hooks, write, fire } = wiring();
	const { guardFocus } = makeGuard({
		run: target.run,
		platform: "darwin",
		hooks,
		write,
		fallback: "Zed",
	});
	expect(guardFocus()).toBe("Zed");
	fire("exit");
	expect(target.opens()).toEqual(["Zed"]);
});

test("the ignore list refuses a suite's own bundle", () => {
	const target = probe({ name: "Hello crust", path: "/Applications/Hello crust.app" });
	const { hooks, write } = wiring();
	const { guardFocus } = makeGuard({
		run: target.run,
		platform: "darwin",
		hooks,
		write,
		ignore: ["Hello crust"],
	});
	expect(guardFocus()).toBe("Ghostty");
});

test("off macOS nothing is captured and nothing is restored", () => {
	const target = probe(brave);
	const { hooks, write, fire } = wiring();
	const { guardFocus } = makeGuard({ run: target.run, platform: "linux", hooks, write });
	expect(guardFocus()).toBeUndefined();
	fire("exit");
	expect(target.calls).toHaveLength(0);
});
