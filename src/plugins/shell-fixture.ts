/**
 * The `crust:shell` suites' shared harness: one temp `cwdRoot` per test, the plugin under test, and typed calls that record what a page would receive.
 * Two suites use it, so neither has to re-implement the wait for an exit or the cleanup of a process a failing assertion left behind.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PluginContext, PluginDefinition } from "./define";
import {
	type OutputOutcome,
	type ShellCommands,
	type SpawnOutcome,
	createShellPlugin,
} from "./shell";
import type { ShellLine } from "./shell-stream";

/** Programs every suite may run; `cat` is the one that reads a pipe and writes both streams. */
export const ALLOW = ["cat", "echo", "sleep", "tool", "crust-no-such-program"];

export type Seen = Array<{ event: string; data: ShellLine }>;

export interface ShellHarness {
	plugin: PluginDefinition<"shell", ShellCommands>;
	root: string;
	/** A command with no context, so nothing is emitted. */
	call<T>(name: string, args: unknown): Promise<T>;
	/** A command with a context, for the emit path. */
	callWith<T>(name: string, args: unknown, ctx: PluginContext): Promise<T>;
	spawn(args: unknown): Promise<SpawnOutcome>;
	spawnWith(args: unknown, ctx: PluginContext): Promise<SpawnOutcome>;
	/** Spawn, or fail the test with the refusal's own message. */
	id(args: unknown): Promise<string>;
	/** Read until the process is gone; `output` waits for the drain once it is. */
	settled(child: string): Promise<Extract<OutputOutcome, { ok: true }>>;
	recorder(): { ctx: PluginContext; seen: Seen };
	/** Kill what the test started, then remove its root. */
	stop(): Promise<void>;
}

export async function shellHarness(): Promise<ShellHarness> {
	const root = await mkdtemp(join(tmpdir(), "crust-shell-"));
	const plugin = createShellPlugin({ allow: ALLOW, cwdRoot: root });
	const started: string[] = [];
	const table = plugin.commands as unknown as Record<
		string,
		(input: unknown, ctx?: PluginContext) => Promise<unknown>
	>;

	const run = async <T>(name: string, args: unknown, ctx?: PluginContext): Promise<T> => {
		const handler = table[name];
		if (handler === undefined) throw new Error(`no command ${name}`);
		return (await handler(args, ctx)) as T;
	};

	const call = <T>(name: string, args: unknown): Promise<T> => run<T>(name, args);

	const spawnWith = async (args: unknown, ctx: PluginContext): Promise<SpawnOutcome> => {
		const result = await run<SpawnOutcome>("spawn", args, ctx);
		if (result.ok) started.push(result.id);
		return result;
	};

	const spawn = (args: unknown): Promise<SpawnOutcome> => spawnWith(args, { emit: () => {} });

	return {
		plugin,
		root,
		call,
		callWith: run,
		spawn,
		spawnWith,
		id: async (args) => {
			const result = await spawn(args);
			if (!result.ok) throw new Error(`spawn refused: ${result.message}`);
			return result.id;
		},
		settled: async (child) => {
			const deadline = Date.now() + 4000;
			for (;;) {
				const out = await call<OutputOutcome>("output", { id: child });
				if (!out.ok) throw new Error(out.message);
				if (out.exitCode !== null || out.signal !== null) return out;
				if (Date.now() > deadline) throw new Error(`process ${child} did not exit`);
				await Bun.sleep(10);
			}
		},
		recorder: () => {
			const seen: Seen = [];
			return {
				ctx: { emit: (event, data) => void seen.push({ event, data: data as ShellLine }) },
				seen,
			};
		},
		stop: async () => {
			for (const child of started) await call("kill", { id: child });
			started.length = 0;
			await rm(root, { recursive: true, force: true });
		},
	};
}
