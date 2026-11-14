/**
 * Spawn a process that has to stay up across an assertion, or across an edit.
 *
 * `e2e-harness.ts`'s `probe` stops the child the moment its proving line
 * appears, which is the right shape for one answer and the wrong one here: the
 * dev-shape proofs compare the same process before and after a save, and need
 * its whole log rather than one line. That is why this is not `probe` widened.
 *
 * The child is its own process group (`detached`), because `crust dev` owns a
 * runtime child *and* a frontend child: signalling only the CLI would leave a
 * window and a dev server behind while reporting success.
 */
import { delay, nthLine } from "./text.ts";
import { alivePid } from "./pids.ts";
import { runCommand } from "../e2e-harness.ts";

export type Stream = "out" | "err";

/** One descendant: which pid, and the command line it was started with. */
export interface Proc {
	pid: number;
	command: string;
}

/** A live child's whole output, kept so several lines can be waited for. */
export interface LiveRun {
	readonly pid: number;
	text(stream: Stream): string;
	wait(stream: Stream, pattern: RegExp, which: number, timeoutMs: number): Promise<string | null>;
	alive(): boolean;
	/** Direct children right now — the runtime `crust dev` spawned. */
	children(): Promise<number[]>;
	/**
	 * Every descendant right now, with the argv it was running under.
	 *
	 * pid and argv are read together because a restart replaces the runtime child:
	 * a pid captured earlier is gone by the time a separate `ps` gets to it, and
	 * the argv of the child that answered is the evidence a proof needs.
	 */
	tree(): Promise<Proc[]>;
	/** SIGTERM the group, then SIGKILL after the grace period. Idempotent. */
	stop(): Promise<number | null>;
}

export interface LiveOptions {
	/** How long the child gets after SIGTERM before SIGKILL. Default 5000. */
	graceMs?: number;
}

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

export function spawnLive(command: string[], cwd: string, options: LiveOptions = {}): LiveRun {
	const graceMs = options.graceMs ?? 5000;
	const child = Bun.spawn({
		cmd: command,
		cwd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		detached: true,
	});

	const streams: Record<Stream, string> = { out: "", err: "" };
	let code: number | null = null;
	let settled = false;

	const exited = child.exited.then((status) => {
		settled = true;
		code = status;
		return status;
	});
	exited.catch(() => undefined);

	// One decoder per stream: a chunk boundary can split a character, and sharing
	// one decoder across two interleaved streams would corrupt both.
	const outDecoder = new TextDecoder();
	void (async () => {
		for await (const chunk of child.stdout)
			streams.out += outDecoder.decode(chunk, { stream: true });
	})().catch(() => undefined);
	const errDecoder = new TextDecoder();
	void (async () => {
		for await (const chunk of child.stderr)
			streams.err += errDecoder.decode(chunk, { stream: true });
	})().catch(() => undefined);

	const text = (stream: Stream): string => streams[stream];

	async function wait(
		stream: Stream,
		pattern: RegExp,
		which: number,
		timeoutMs: number,
	): Promise<string | null> {
		const deadline = performance.now() + timeoutMs;
		for (;;) {
			const found = nthLine(streams[stream], pattern, which);
			if (found !== null) return found;
			// A child that exited will never print the line; report that now rather
			// than burning the whole deadline on a process that is already gone.
			if (settled || performance.now() >= deadline) return null;
			await delay(50);
		}
	}

	/** pgrep exits 1 when a pid has no children; that is an empty answer. */
	async function childrenOf(pid: number): Promise<number[]> {
		const { stdout } = await runCommand(["pgrep", "-P", String(pid)], cwd);
		return stdout
			.split("\n")
			.map((line) => Number.parseInt(line.trim(), 10))
			.filter((childPid) => Number.isInteger(childPid) && childPid > 0);
	}

	async function descendants(): Promise<number[]> {
		const seen: number[] = [];
		const queue = [child.pid];
		while (queue.length > 0) {
			const pid = queue.shift();
			if (pid === undefined) break;
			for (const next of await childrenOf(pid)) {
				if (seen.includes(next)) continue;
				seen.push(next);
				queue.push(next);
			}
		}
		return seen;
	}

	async function commandOf(pid: number): Promise<string> {
		const { stdout } = await runCommand(["ps", "-o", "command=", "-p", String(pid)], cwd);
		return stdout.trim();
	}

	async function tree(): Promise<Proc[]> {
		const records: Proc[] = [];
		for (const pid of await descendants()) {
			let command = await commandOf(pid);
			// A child can leave between the `pgrep` walk and this `ps`; one retry
			// separates "it went away" from "it never had an argv".
			if (command.length === 0) {
				await delay(50);
				command = await commandOf(pid);
			}
			records.push({ pid, command });
		}
		return records;
	}

	let stopping: Promise<number | null> | undefined;
	async function stop(): Promise<number | null> {
		signalGroup(child.pid, "SIGTERM");
		await Promise.race([exited, delay(graceMs)]);
		if (!settled) {
			// Still alive after the grace period: it answers no SIGTERM.
			signalGroup(child.pid, "SIGKILL");
			await Promise.race([exited, delay(2000)]);
		}
		return code;
	}

	return {
		pid: child.pid,
		text,
		wait,
		alive: () => alivePid(child.pid),
		children: () => childrenOf(child.pid),
		tree,
		stop: () => {
			stopping ??= stop();
			return stopping;
		},
	};
}
