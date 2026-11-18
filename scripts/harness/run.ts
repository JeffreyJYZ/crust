/**
 * Run a command, capture both streams, and bound it by a real deadline. Split from `verdict.ts` so a
 * script that only prints verdicts does not drag process plumbing in.
 * A child that never exits — or one whose helper keeps the stdout pipe open after it does — otherwise
 * waits forever, which reads as a slow run rather than a failure. On expiry the child's process group
 * gets `SIGTERM`, then `SIGKILL` after a grace period, and `code` stays `null` so no caller can read a
 * give-up as a pass.
 */
export interface RunResult {
	/** Exit code, or `null` when a signal ended it or the deadline did. */
	code: number | null;
	stdout: string;
	stderr: string;
	/** Why it returned: the child's own exit, or the deadline. */
	ended: "exit" | "timeout";
}

export interface RunOptions {
	/** Hard deadline from spawn. Default five minutes: a cold `bun install` or `hdiutil` under load is minutes, never an hour. */
	timeoutMs?: number;
	/** How long the child gets to leave after `SIGTERM`. Default 5000. */
	graceMs?: number;
}

const DEFAULT_TIMEOUT_MS = 300_000;

/** Signal the child's process group, falling back to the child alone. */
function signalGroup(pid: number, signal: NodeJS.Signals): void {
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

function delay(ms: number): Promise<null> {
	return new Promise((resolve) => setTimeout(() => resolve(null), ms));
}

/**
 * Run a command, capture both streams, never throw on a non-zero exit. The child is its own process
 * group (`detached`) so a helper it spawned is signalled too — that helper is exactly what keeps a
 * pipe open after the parent is gone.
 */
export async function runCommand(
	command: string[],
	cwd: string,
	options: RunOptions = {},
): Promise<RunResult> {
	const budget = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const child = Bun.spawn({
		cmd: command,
		cwd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		detached: true,
	});

	let stdout = "";
	let stderr = "";
	let code: number | null = null;
	let settled = false;
	const decoder = new TextDecoder();
	const pump = async (stream: ReadableStream<Uint8Array>, sink: (text: string) => void) => {
		for await (const chunk of stream) sink(decoder.decode(chunk, { stream: true }));
	};
	const pumping = Promise.all([
		pump(child.stdout, (text) => {
			stdout += text;
		}),
		pump(child.stderr, (text) => {
			stderr += text;
		}),
	]).catch(() => undefined);

	const exited = child.exited.then((status) => {
		settled = true;
		code = status;
		return "exit" as const;
	});

	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<"timeout">((resolve) => {
		timer = setTimeout(() => resolve("timeout"), Math.max(0, budget));
	});
	const outcome = await Promise.race([exited, deadline]);
	if (timer !== undefined) clearTimeout(timer);

	let ended: RunResult["ended"] = "exit";
	if (outcome === "timeout") {
		ended = "timeout";
		signalGroup(child.pid, "SIGTERM");
		await Promise.race([exited, delay(options.graceMs ?? 5000)]);
		if (!settled) signalGroup(child.pid, "SIGKILL");
		// A process that survives `SIGKILL` is a kernel problem, and waiting on it would hang here.
		await Promise.race([exited, delay(2000)]);
	}

	// Buffered output may still be arriving; give the readers a moment, then stop waiting.
	await Promise.race([pumping, delay(500)]);

	if (ended === "timeout") {
		// The deadline ended it, so its own exit code — often `SIGTERM`'s 143 — is a fact about the kill,
		// not about the command. `null` is the only code a caller cannot read as a normal exit.
		code = null;
		const budgetText = budget >= 1000 ? `${Math.round(budget / 1000)} s` : `${budget} ms`;
		const why = `did not finish within ${budgetText} and was killed`;
		stderr = `${stderr}${stderr.endsWith("\n") || stderr === "" ? "" : "\n"}${command[0]} ${why}`;
	}
	return { code, stdout, stderr, ended };
}
