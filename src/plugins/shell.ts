/**
 * `crust:shell` — the page-facing process API: spawn an allowlisted program, feed its stdin, read its bounded output, kill it, list what is live.
 * No shell is ever invoked, so a page's argument reaches the program as argv and never as a command line, and a program not named in `allow` is refused before any process exists.
 * The allow list is a set of real paths, not names, and a page-supplied `env` is refused unless the host opts in — either one alone would make the list decorative.
 */

import { definePlugin, type PluginContext, type PluginDefinition } from "./define";
import { type SpawnArgs, parseSpawn, requireId, unknownProcess } from "./shell-args";
import { type ShellFailure, shellFailure } from "./shell-failure";
import { type ShellRuleOptions, shellRules } from "./shell-resolve";
import { type WriteArgs, noStdin, readWrite } from "./shell-stdin";
import {
	type Child,
	createLineRing,
	drain,
	type Emit,
	finished,
	type LineRing,
	lineSink,
	signalName,
} from "./shell-stream";

export { createLineRing, SHELL_OUTPUT_LINES } from "./shell-stream";

const MAX_RECORDS = 256; // finished records kept, so `output` still answers after exit

/** A thrown value as the one line a refusal message can carry. */
function text(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export type SpawnOutcome = { ok: true; id: string } | ShellFailure;
export type WriteOutcome = { ok: true; bytes: number } | ShellFailure;
export type CloseOutcome = { ok: true; closed: boolean; id: string } | ShellFailure;
export type KillOutcome = { ok: true; killed: boolean; id: string } | ShellFailure;
export type ListOutcome = { ok: true; ids: string[] };
export type OutputOutcome =
	| { ok: true; stdout: string; stderr: string; exitCode: number | null; signal: string | null }
	| ShellFailure;

export type ShellCommands = {
	spawn: (args: SpawnArgs) => Promise<SpawnOutcome>;
	output: (args: { id: string }) => Promise<OutputOutcome>;
	write: (args: WriteArgs) => Promise<WriteOutcome>;
	close: (args: { id: string }) => Promise<CloseOutcome>;
	kill: (args: { id: string }) => Promise<KillOutcome>;
	list: () => ListOutcome;
};

/**
 * The host's rules: what a page may run, where, and whether it may configure the environment.
 * One definition, in `shell-resolve.ts`, because that is what reads them.
 */
export type ShellOptions = ShellRuleOptions;

interface Live {
	id: string;
	child: Child;
	stdout: LineRing;
	stderr: LineRing;
	drained: Promise<void>;
	/** Set once `close` ended stdin, so a later `write` answers `no-stdin` instead of throwing. */
	stdinClosed: boolean;
}

export function createShellPlugin(
	options: ShellOptions = {},
): PluginDefinition<"shell", ShellCommands> {
	const rules = shellRules(options);
	const processes = new Map<string, Live>();
	let next = 0;

	// Records outlive their process so `output` still answers; past the cap the
	// oldest finished ones go, which is the only growth this map has.
	const prune = (): void => {
		for (const [id, record] of processes) {
			if (processes.size <= MAX_RECORDS) return;
			if (finished(record.child)) processes.delete(id);
		}
	};

	return definePlugin({
		name: "shell",
		commands: {
			spawn: async (args: SpawnArgs, ctx?: PluginContext): Promise<SpawnOutcome> => {
				const plan = parseSpawn(args, rules);
				if (!plan.ok) return plan;
				let child: Child;
				try {
					child = Bun.spawn({
						cmd: plan.cmd,
						cwd: plan.cwd,
						env: { ...process.env, ...plan.env },
						stdin: plan.pipe ? "pipe" : "ignore",
						stdout: "pipe",
						stderr: "pipe",
					});
				} catch (error) {
					return shellFailure(
						"spawn-failed",
						`shell.spawn: ${JSON.stringify(plan.cmd[0])} could not start: ${text(error)}`,
					);
				}
				const id = `shell-${++next}`;
				const emit: Emit | undefined = ctx?.emit;
				const stdout = createLineRing();
				const stderr = createLineRing();
				const drained = Promise.all([
					drain(child.stdout, stdout, lineSink(emit, id, "stdout")),
					drain(child.stderr, stderr, lineSink(emit, id, "stderr")),
				]).then(() => undefined);
				processes.set(id, { id, child, stdout, stderr, drained, stdinClosed: false });
				prune();
				return { ok: true, id };
			},
			output: async (args: { id: string }): Promise<OutputOutcome> => {
				const asked = requireId(args, "output");
				if (!asked.ok) return asked;
				const record = processes.get(asked.id);
				if (record === undefined) return unknownProcess("output", asked.id);
				// The pipe closes just after the exit, so the ring is complete only
				// once the drain has ended.
				if (finished(record.child)) await record.drained;
				return {
					ok: true,
					stdout: record.stdout.lines().join("\n"),
					stderr: record.stderr.lines().join("\n"),
					exitCode: record.child.exitCode,
					signal: signalName(record.child.signalCode),
				};
			},
			write: async (args: WriteArgs): Promise<WriteOutcome> => {
				const parsed = readWrite(args);
				if (parsed === undefined) {
					return shellFailure(
						"invalid-args",
						'shell.write needs { id, data } with an id and a string "data"',
					);
				}
				const record = processes.get(parsed.id);
				if (record === undefined) return unknownProcess("write", parsed.id);
				const sink = record.child.stdin;
				if (sink === undefined || record.stdinClosed) return noStdin("write", parsed.id);
				try {
					await sink.write(parsed.data);
					await sink.flush();
				} catch (error) {
					return noStdin("write", parsed.id, text(error));
				}
				return { ok: true, bytes: Buffer.byteLength(parsed.data) };
			},
			close: async (args: { id: string }): Promise<CloseOutcome> => {
				const asked = requireId(args, "close");
				if (!asked.ok) return asked;
				const id = asked.id;
				const record = processes.get(id);
				if (record === undefined) return unknownProcess("close", id);
				const sink = record.child.stdin;
				if (sink === undefined || record.stdinClosed)
					return { ok: true, closed: false, id };
				record.stdinClosed = true;
				try {
					await sink.end();
				} catch {
					// An exited process already closed its own stdin; the page asked for that end.
				}
				return { ok: true, closed: true, id };
			},
			kill: async (args: { id: string }): Promise<KillOutcome> => {
				const asked = requireId(args, "kill");
				if (!asked.ok) return asked;
				const id = asked.id;
				const record = processes.get(id);
				if (record === undefined) return unknownProcess("kill", id);
				if (finished(record.child)) return { ok: true, killed: false, id };
				record.child.kill();
				return { ok: true, killed: true, id };
			},
			list: (): ListOutcome => ({
				ok: true,
				ids: [...processes.values()]
					.filter((record) => !finished(record.child))
					.map((record) => record.id),
			}),
		},
	});
}
