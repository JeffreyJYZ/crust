/**
 * Spawn a child, wait for its proving line, then stop it and report both facts.
 *
 * Why the child is bounded by hand: macOS ships no `timeout(1)`. A plain
 * `await child.exited` on a hung app hangs the harness with it, which is worse
 * than a failure — it looks like a slow run forever. So every child gets a hard
 * deadline, a `SIGTERM` to its process group, then `SIGKILL` after a grace
 * period, and the deadline is what the failure line reports.
 */
export interface ProbeOptions {
	command: string[];
	cwd: string;
	/** The line that proves the app works. Matched against stdout only. */
	match: RegExp;
	/** Hard deadline from spawn. On expiry: SIGTERM, then SIGKILL after `graceMs`. */
	timeoutMs: number;
	/** How long the child gets to exit after SIGTERM before SIGKILL. Default 5000. */
	graceMs?: number;
}

export interface Probe {
	/** Exit code, or null when a signal ended the child. */
	code: number | null;
	signal: string | number | null;
	stdout: string;
	stderr: string;
	/** The full line that satisfied `match`, or null if it never appeared. */
	matched: string | null;
	/** Why the probe returned: the match, the child's own exit, or the deadline. */
	ended: "match" | "exit" | "timeout";
	matchedMs: number | null;
	exitMs: number | null;
	/** The child was still alive at the deadline and had to be killed. */
	timedOut: boolean;
}

/** The full line containing the first match of `pattern`, trimmed. */
function matchedLine(text: string, pattern: RegExp): string | null {
	const found = text.match(pattern);
	if (!found || found.index === undefined) return null;
	const start = text.lastIndexOf("\n", found.index) + 1;
	const end = text.indexOf("\n", found.index);
	return text.slice(start, end === -1 ? undefined : end).trim();
}

/** Signal the child's process group, falling back to the child alone. */
function signalChild(pid: number, signal: NodeJS.Signals): void {
	try {
		process.kill(-pid, signal);
		return;
	} catch {
		// No group (already gone, or not a leader); aim at the child itself.
	}
	try {
		process.kill(pid, signal);
	} catch {
		// Nothing left to signal.
	}
}

function delay(ms: number): Promise<"delay"> {
	return new Promise((resolve) => setTimeout(() => resolve("delay"), ms));
}

/**
 * Spawn, wait for the proving line, stop, report.
 *
 * The child is its own process group (`detached`), because both proofs spawn a
 * process that starts another: a built app launches WebKit helpers and
 * `crust dev` owns its runtime child. Signalling the group is what makes "no
 * survivors" an assertion instead of a hope.
 */
export async function probe(options: ProbeOptions): Promise<Probe> {
	const started = performance.now();
	const child = Bun.spawn({
		cmd: options.command,
		cwd: options.cwd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		detached: true,
	});

	let stdout = "";
	let stderr = "";
	let matched: string | null = null;
	let matchedMs: number | null = null;
	let exitMs: number | null = null;
	let code: number | null = null;
	let signal: string | number | null = null;
	let resolveMatch: (() => void) | null = null;
	const sawMatch = new Promise<void>((resolve) => {
		resolveMatch = resolve;
	});

	const decoder = new TextDecoder();
	const consume = (stream: "out" | "err", chunk: Uint8Array): void => {
		const text = decoder.decode(chunk, { stream: true });
		if (stream === "out") stdout += text;
		else stderr += text;
		if (matched === null) {
			const line = matchedLine(stdout, options.match);
			if (line !== null) {
				matched = line;
				matchedMs = performance.now() - started;
				resolveMatch?.();
			}
		}
	};

	const pumping = Promise.all([
		(async () => {
			for await (const chunk of child.stdout) consume("out", chunk);
		})(),
		(async () => {
			for await (const chunk of child.stderr) consume("err", chunk);
		})(),
	]).catch(() => undefined);

	let settled = false;
	const exited = child.exited.then((status) => {
		settled = true;
		code = status;
		signal = child.signalCode ?? null;
		exitMs = performance.now() - started;
		return "exit" as const;
	});

	let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<"timeout">((resolve) => {
		deadlineTimer = setTimeout(() => resolve("timeout"), Math.max(0, options.timeoutMs));
	});

	const outcome = await Promise.race([sawMatch.then(() => "match" as const), exited, deadline]);
	if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);

	let timedOut = false;
	let ended: Probe["ended"];
	if (outcome === "match") {
		ended = "match";
		signalChild(child.pid, "SIGTERM");
		await Promise.race([exited, delay(options.graceMs ?? 5000)]);
		if (!settled) {
			// Still alive after the grace period: the app answers no SIGTERM.
			signalChild(child.pid, "SIGKILL");
		}
	} else if (outcome === "exit") {
		ended = "exit";
	} else {
		ended = "timeout";
		timedOut = true;
		signalChild(child.pid, "SIGTERM");
		await Promise.race([exited, delay(2000)]);
		if (!settled) {
			signalChild(child.pid, "SIGKILL");
		}
	}

	// Bounded for the same reason as the deadline: a process that survives
	// SIGKILL is a kernel problem, and waiting on it would hang the harness.
	await Promise.race([exited, delay(2000)]);
	// Buffered output may still be on its way through the pipes; give the readers
	// a moment, then stop waiting — a WebKit helper can hold the far end open.
	await Promise.race([pumping, delay(500)]);

	return {
		code,
		signal,
		stdout,
		stderr,
		matched,
		ended,
		matchedMs,
		exitMs,
		timedOut,
	};
}
