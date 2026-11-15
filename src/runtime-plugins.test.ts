import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ShellConfig } from "@/config";
import type { PluginDefinition } from "@/plugins/define";
import type { OutputOutcome, ShellCommands, SpawnOutcome } from "@/plugins/shell";
import { nativePlugins } from "@/runtime-plugins.ts";

type Shell = PluginDefinition<"shell", ShellCommands>;

const started: { plugin: Shell; id: string }[] = [];
let root: string | undefined;

/** The shell plugin `startApp` gets, built from a config's `shell` section. */
async function shellPlugin(shell?: ShellConfig): Promise<Shell> {
	const plugins = await nativePlugins([], undefined, shell);
	const found = plugins.find((plugin) => plugin.name === "shell");
	if (found === undefined) throw new Error("nativePlugins did not register shell");
	return found as Shell;
}

async function call<T>(plugin: Shell, name: string, args: unknown): Promise<T> {
	const table = plugin.commands as unknown as Record<
		string,
		(input: unknown) => Promise<unknown>
	>;
	const handler = table[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return (await handler(args)) as T;
}

/** Read until the process is gone; `output` waits for the drain once it is. */
async function settled(plugin: Shell, id: string): Promise<Extract<OutputOutcome, { ok: true }>> {
	const deadline = Date.now() + 4000;
	for (;;) {
		const out = await call<OutputOutcome>(plugin, "output", { id });
		if (!out.ok) throw new Error(out.message);
		if (out.exitCode !== null || out.signal !== null) return out;
		if (Date.now() > deadline) throw new Error(`process ${id} did not exit`);
		await Bun.sleep(10);
	}
}

afterEach(async () => {
	for (const { plugin, id } of started) await call(plugin, "kill", { id });
	started.length = 0;
	if (root !== undefined) await rm(root, { recursive: true, force: true });
	root = undefined;
});

describe("shell registration", () => {
	test("no shell section registers the plugin and refuses every program", async () => {
		const plugin = await shellPlugin();
		expect(await call(plugin, "spawn", { program: "echo", args: ["hi"] })).toMatchObject({
			ok: false,
			code: "program-not-allowed",
		});
	});

	test("an allowlisted program runs and output carries its stdout", async () => {
		const plugin = await shellPlugin({ allow: ["echo"] });
		const spawned = await call<SpawnOutcome>(plugin, "spawn", {
			program: "echo",
			args: ["hi"],
		});
		if (!spawned.ok) throw new Error(`spawn refused: ${spawned.message}`);
		started.push({ plugin, id: spawned.id });
		const out = await settled(plugin, spawned.id);
		expect(out).toMatchObject({ ok: true, stdout: "hi", exitCode: 0 });
	});

	test("a program outside the allow list is refused by name", async () => {
		const plugin = await shellPlugin({ allow: ["echo"] });
		expect(await call(plugin, "spawn", { program: "true" })).toMatchObject({
			ok: false,
			code: "program-not-allowed",
			message: expect.stringContaining("true"),
		});
	});

	test("a cwd outside cwdRoot is refused", async () => {
		root = await mkdtemp(join(tmpdir(), "crust-shell-config-"));
		const plugin = await shellPlugin({ allow: ["echo"], cwdRoot: root });
		expect(await call(plugin, "spawn", { program: "echo", cwd: "/" })).toMatchObject({
			ok: false,
			code: "cwd-not-allowed",
		});
	});
});
