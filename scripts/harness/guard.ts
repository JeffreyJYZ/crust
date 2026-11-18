/**
 * The focus guard: capture the frontmost app once, then restore it even when the suite never reaches its own cleanup. A Ctrl-C, a `kill` or a CI timeout runs no `finally`, so `guardFocus()` installs an `exit` handler and one per signal, each of which restores synchronously — an `exit` handler cannot await, so that path is `spawnSync` of the same `open -a` the async path uses.
 * It also refuses to activate one of our own test apps: a suite that captured the previous suite's window would otherwise hand focus to a dead test app, and the next suite would capture that in turn. Refusing turns a cascade into one leak, and the fallback is said on stderr once.
 */

/** The terminal to fall back to when the frontmost app could not be captured. */
export const FALLBACK_APP = "Ghostty";

/** The name of the app the OS currently considers frontmost. */
export const FRONTMOST_SCRIPT =
	'tell application "System Events" to get name of first process whose frontmost is true';

/** Hard ceiling on every spawn here: a wedged System Events must never hold a gate or an exit. */
export const COMMAND_TIMEOUT_MS = 3000;

/** A command run to completion: its exit code and captured stdout. */
export interface CommandResult {
	code: number;
	stdout: string;
}

/** A blocking runner. An `exit` handler cannot await, so the guard's path reads this. */
export type SyncRunner = (command: string[], timeoutMs: number) => CommandResult;

/** The real blocking runner: `spawnSync`, the one place a blocking call is correct. */
const bunSyncRunner: SyncRunner = (command, timeoutMs) => {
	try {
		const result = Bun.spawnSync(command, {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "ignore",
			timeout: timeoutMs,
		});
		return { code: result.exitCode ?? 1, stdout: result.stdout.toString() };
	} catch {
		// No `open`, no osascript: the courtesy is unavailable.
		return { code: 1, stdout: "" };
	}
};

/** The events that skip a suite's own cleanup: its normal exit plus the three that kill it. */
export const GUARD_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
export type GuardSignal = (typeof GUARD_SIGNALS)[number];
export type GuardEvent = "exit" | GuardSignal;

/** Injectable process wiring, so a test can fire a handler without signalling its own runner. */
export interface GuardHooks {
	on: (event: GuardEvent, listener: () => void) => () => void;
	die: (signal: GuardSignal) => void;
}

/** The real wiring: a signal restores, then re-raises so the exit status stays the signal's own. */
const processHooks: GuardHooks = {
	on: (event, listener) => {
		process.on(event, listener);
		return () => void process.removeListener(event, listener);
	},
	die: (signal) => void process.kill(process.pid, signal),
};

/** A process name or path that marks one of our own test apps. */
const OWN_NAME = /crust-e2e|^crust-app$/i;
const OWN_PATH = /crust-e2e|\/T\/|\/tmp\//i;

/** Quote a name for an AppleScript string literal. */
const quote = (name: string): string => name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** The frontmost app's name, or undefined when the probe failed or printed nothing. */
const captureName = (run: SyncRunner): string | undefined => {
	const { code, stdout } = run(["osascript", "-e", FRONTMOST_SCRIPT], COMMAND_TIMEOUT_MS);
	const name = stdout.trim();
	return code === 0 && name.length > 0 ? name : undefined;
};

/** The bundle path a process runs from, or undefined when System Events cannot answer. */
const processPath = (name: string, run: SyncRunner): string | undefined => {
	const script = `tell application "System Events" to get POSIX path of file of process "${quote(name)}"`;
	const { code, stdout } = run(["osascript", "-e", script], COMMAND_TIMEOUT_MS);
	const path = stdout.trim();
	return code === 0 && path.length > 0 ? path : undefined;
};

/** How many windows a process owns, or undefined when the count could not be read. */
const windowCount = (name: string, run: SyncRunner): number | undefined => {
	const script = `tell application "System Events" to count windows of process "${quote(name)}"`;
	const { code, stdout } = run(["osascript", "-e", script], COMMAND_TIMEOUT_MS);
	const count = Number.parseInt(stdout.trim(), 10);
	return code === 0 && Number.isFinite(count) ? count : undefined;
};

/** Why this app must not be activated, or undefined when it is the human's own. */
const refusal = (name: string, run: SyncRunner, ignore: readonly string[]): string | undefined => {
	const lower = name.toLowerCase();
	if (ignore.some((entry) => entry.toLowerCase() === lower))
		return `${name} is on the ignore list`;
	if (OWN_NAME.test(name)) return `${name} is a crust test app`;
	const path = processPath(name, run);
	if (path !== undefined && OWN_PATH.test(path)) return `${name} runs from a scratch path`;
	if (windowCount(name, run) === 0) return `${name} has no window`;
	return undefined;
};

/** Options for `makeGuard`: every external effect injected, so a test never touches the screen. */
export interface GuardOptions {
	run: SyncRunner;
	platform: string;
	/** Where to send the human when the captured app must not be activated. */
	fallback?: string;
	/** Extra app names that must never be activated, e.g. a suite's own bundle. */
	ignore?: readonly string[];
	/** One line per refusal, printed once. Defaults to stderr. */
	write?: (line: string) => void;
	hooks?: GuardHooks;
}

export function makeGuard(options: GuardOptions) {
	const fallback = options.fallback ?? FALLBACK_APP;
	const write = options.write ?? ((line: string) => void process.stderr.write(line));
	const hooks = options.hooks ?? processHooks;
	const ignore = options.ignore ?? [];

	let target: string | undefined;
	let armed = false;
	let restored = false;
	let noted = false;
	let disarm = (): void => {};

	/** Say once why the captured app was refused, so a cascade is visible rather than silent. */
	const note = (reason: string): void => {
		if (noted) return;
		noted = true;
		write(`focus: ${reason}; restoring ${fallback} instead\n`);
	};

	/** The only restore an `exit` or signal handler can run: blocking, idempotent, never throws. */
	const restoreSync = (): void => {
		if (options.platform !== "darwin" || restored) return;
		restored = true;
		options.run(["open", "-a", target ?? fallback], COMMAND_TIMEOUT_MS);
	};

	const decide = (): string | undefined => {
		if (options.platform !== "darwin") return undefined;
		const name = captureName(options.run);
		if (name === undefined) return fallback;
		const reason = refusal(name, options.run, ignore);
		if (reason === undefined) return name;
		note(reason);
		return fallback;
	};

	/**
	 * Capture the frontmost app once and restore it from `exit` and the three signals. Idempotent:
	 * a second call returns the same target without capturing again or restoring twice.
	 */
	const guardFocus = (): string | undefined => {
		if (armed) return target;
		armed = true;
		const offs = GUARD_SIGNALS.map((signal) =>
			hooks.on(signal, () => {
				restoreSync();
				disarm();
				hooks.die(signal);
			}),
		);
		offs.push(hooks.on("exit", restoreSync));
		disarm = () => {
			for (const off of offs) off();
			offs.length = 0;
		};
		target = decide();
		return target;
	};

	return { guardFocus };
}

export const guardFocus = makeGuard({
	run: bunSyncRunner,
	platform: process.platform,
	fallback: process.env.CRUST_FOCUS_FALLBACK,
	ignore: (process.env.CRUST_FOCUS_IGNORE ?? "")
		.split(",")
		.map((name) => name.trim())
		.filter((name) => name.length > 0),
}).guardFocus;
