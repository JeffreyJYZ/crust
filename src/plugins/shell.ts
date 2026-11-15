/**
 * `crust:shell` — the page-facing process API: spawn an allowlisted program, read its bounded output, kill it, list what is live.
 * No shell is ever invoked, so a page's argument reaches the program as argv and never as a command line, and a program not named in `allow` is refused before any process exists.
 */

import { constants } from "node:os";
import { resolve } from "node:path";

import { definePlugin, type PluginDefinition } from "./define";
import {
	type ShellFailure,
	type SpawnArgs,
	parseSpawn,
	readId,
	shellFailure,
	unknownProcess,
} from "./shell-args";

export const SHELL_OUTPUT_LINES = 500; // per stream; older lines drop, so a chatty program cannot grow it
const MAX_LINE = 8192; // a longer line is flushed in pieces, so a stream with no newline stays bounded
const MAX_RECORDS = 256; // finished records kept, so `output` still answers after exit

export type LineRing = { push(line: string): void; lines(): string[] };

export function createLineRing(limit = SHELL_OUTPUT_LINES): LineRing {
	const kept: string[] = [];
	return {
		push(line) {
			kept.push(line.length > MAX_LINE ? line.slice(0, MAX_LINE) : line);
			if (kept.length > limit) kept.shift();
		},
		lines: () => [...kept],
	};
}

type Child = Bun.Subprocess<"ignore", "pipe", "pipe">;

/** Read one stream to its end, keeping only complete lines in the ring. */
async function drain(stream: Child["stdout"], ring: LineRing): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let partial = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		partial += decoder.decode(value, { stream: true });
		const rows = partial.split("\n");
		partial = rows.pop() ?? "";
		for (const row of rows) ring.push(row);
		if (partial.length > MAX_LINE) {
			ring.push(partial);
			partial = "";
		}
	}
	partial += decoder.decode();
	if (partial.length > 0) ring.push(partial);
}

/** A killed process reports a signal and no exit code, so either one means it is gone. */
function finished(child: Child): boolean {
	return child.exitCode !== null || child.signalCode !== null;
}

/** Bun names a signal, or reports a raw number when it has no name. */
function signalName(signal: Child["signalCode"]): string | null {
	if (signal === null || typeof signal === "string") return signal;
	const named = Object.entries(constants.signals).find(([, value]) => value === signal);
	return named ? named[0] : String(signal);
}

export type SpawnOutcome = { ok: true; id: string } | ShellFailure;
export type OutputOutcome =
	| { ok: true; stdout: string; stderr: string; exitCode: number | null; signal: string | null }
	| ShellFailure;
export type KillOutcome = { ok: true; killed: boolean; id: string } | ShellFailure;
export type ListOutcome = { ok: true; ids: string[] };

export type ShellCommands = {
	spawn: (args: SpawnArgs) => Promise<SpawnOutcome>;
	output: (args: { id: string }) => Promise<OutputOutcome>;
	kill: (args: { id: string }) => Promise<KillOutcome>;
	list: () => ListOutcome;
};

export interface ShellOptions {
	/** Program names a page may run; an empty or absent list runs nothing. */
	allow?: readonly string[];
	/** Every `cwd` and every path-form program must stay inside this directory. */
	cwdRoot?: string;
}

interface Live {
	id: string;
	child: Child;
	stdout: LineRing;
	stderr: LineRing;
	drained: Promise<void>;
}

export function createShellPlugin(
	options: ShellOptions = {},
): PluginDefinition<"shell", ShellCommands> {
	const allow = [...(options.allow ?? [])];
	const root = resolve(options.cwdRoot ?? process.cwd());
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
			spawn: async (args: SpawnArgs): Promise<SpawnOutcome> => {
				const plan = parseSpawn(args, { allow, root });
				if (!plan.ok) return plan;
				let child: Child;
				try {
					child = Bun.spawn({
						cmd: plan.cmd,
						cwd: plan.cwd,
						env: { ...process.env, ...plan.env },
						stdin: "ignore",
						stdout: "pipe",
						stderr: "pipe",
					});
				} catch (error) {
					const text = error instanceof Error ? error.message : String(error);
					return shellFailure(
						"spawn-failed",
						`shell.spawn: ${JSON.stringify(plan.cmd[0])} could not start: ${text}`,
					);
				}
				const id = `shell-${++next}`;
				const stdout = createLineRing();
				const stderr = createLineRing();
				const drained = Promise.all([
					drain(child.stdout, stdout),
					drain(child.stderr, stderr),
				]).then(() => undefined);
				processes.set(id, { id, child, stdout, stderr, drained });
				prune();
				return { ok: true, id };
			},
			output: async (args: { id: string }): Promise<OutputOutcome> => {
				const id = readId(args);
				if (id === undefined) {
					return shellFailure(
						"invalid-args",
						"shell.output needs { id } with a non-empty string",
					);
				}
				const record = processes.get(id);
				if (record === undefined) return unknownProcess("output", id);
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
			kill: async (args: { id: string }): Promise<KillOutcome> => {
				const id = readId(args);
				if (id === undefined) {
					return shellFailure(
						"invalid-args",
						"shell.kill needs { id } with a non-empty string",
					);
				}
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
