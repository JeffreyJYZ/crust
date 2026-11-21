/**
 * The finding this file pins: `stronghold` used to sit in `corePlugins` as a bare singleton, so its
 * file was always `~/Library/Application Support/crust/stronghold.json` for every crust app. The
 * first app to write owned the password header; another app with a different password got
 * `bad-password` forever, and with the same password read the first app's secrets. The runtime now
 * builds the vault with the app's own data root, exactly as it builds `store` and `database`.
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { DarwinPlatform } from "@/platform/darwin";
import { corePlugins } from "@/plugins/core";
import type { PluginDefinition } from "@/plugins/define";
import { STORE_FILE } from "@/plugins/stronghold";
import { defaultStateRoot } from "@/plugins/window-persist-store";
import { nativePlugins } from "@/runtime-plugins.ts";

type Commands = Record<string, (args: unknown) => unknown>;

function call(vault: Commands, name: string, args: unknown): unknown {
	const handler = vault[name];
	if (typeof handler !== "function") throw new Error(`no command ${name}`);
	return handler(args);
}

/** The one registered `stronghold` for an app id, on an OS arm of the runtime. */
async function vaultFor(id: string, os: string): Promise<Commands> {
	const platform = os === "darwin" ? ({} as DarwinPlatform) : undefined;
	// The darwin arm builds a live NSStatusItem for `tray`; one per process is enough for a test
	// that only cares about the vault. Every other core plugin, including `stronghold`, stays in.
	const core = os === "darwin" ? corePlugins.filter((p) => p.name !== "tray") : corePlugins;
	const plugins = await nativePlugins(core, platform, { app: id }, os);
	const entries = plugins.filter((plugin: PluginDefinition) => plugin.name === "stronghold");
	// One namespace, not a second bare core registration behind the per-app one.
	expect(entries).toHaveLength(1);
	return entries[0]!.commands as unknown as Commands;
}

async function open(vault: Commands, password: string): Promise<void> {
	expect(await call(vault, "open", { password })).toEqual({ ok: true, opened: true });
}

describe("the stronghold vault is per app", () => {
	for (const os of ["darwin", "linux", "win32"]) {
		test(`${os}: two app ids get two independent vaults`, async () => {
			const saved = process.env.CRUST_DATA_DIR;
			delete process.env.CRUST_DATA_DIR;
			const seed = Date.now();
			const idA = `land.jyz.vault-a-${seed}-${os}`;
			const idB = `land.jyz.vault-b-${seed}-${os}`;
			try {
				expect(defaultStateRoot(idA)).not.toBe(defaultStateRoot(idB));
				const a = await vaultFor(idA, os);
				await open(a, "pw-a");
				expect(await call(a, "set", { key: "token", value: "A-secret" })).toMatchObject({
					ok: true,
				});

				// Different password: app B opens its own empty vault rather than being locked out
				// by app A's header, and it cannot read A's secret.
				const b = await vaultFor(idB, os);
				await open(b, "pw-b");
				expect(await call(b, "get", { key: "token" })).toMatchObject({ code: "not-found" });

				// Reopening A's vault confirms the secret stayed with A's own file.
				const aAgain = await vaultFor(idA, os);
				await open(aAgain, "pw-a");
				expect(await call(aAgain, "get", { key: "token" })).toMatchObject({
					ok: true,
					value: "A-secret",
				});
			} finally {
				await rm(join(defaultStateRoot(idA)), { recursive: true, force: true });
				await rm(join(defaultStateRoot(idB)), { recursive: true, force: true });
				if (saved !== undefined) process.env.CRUST_DATA_DIR = saved;
			}
		});
	}
});

describe("the vault file name", () => {
	test("carries the app id, so two app ids can never resolve to one file", async () => {
		const saved = process.env.CRUST_DATA_DIR;
		delete process.env.CRUST_DATA_DIR;
		const seed = Date.now();
		const idA = `land.jyz.vault-path-a-${seed}`;
		const idB = `land.jyz.vault-path-b-${seed}`;
		try {
			const rootA = defaultStateRoot(idA);
			const rootB = defaultStateRoot(idB);
			expect(rootA).toContain(idA);
			expect(rootB).toContain(idB);
			expect(rootA).not.toBe(rootB);
			const fileA = join(rootA, STORE_FILE);
			const fileB = join(rootB, STORE_FILE);
			expect(fileA).not.toBe(fileB);

			for (const [id, file] of [
				[idA, fileA],
				[idB, fileB],
			] as const) {
				const vault = await vaultFor(id, "linux");
				await open(vault, "pw");
				expect(await call(vault, "set", { key: "k", value: "v" })).toMatchObject({
					ok: true,
				});
				expect(await Bun.file(file).exists()).toBe(true);
			}
		} finally {
			await rm(defaultStateRoot(idA), { recursive: true, force: true });
			await rm(defaultStateRoot(idB), { recursive: true, force: true });
			if (saved !== undefined) process.env.CRUST_DATA_DIR = saved;
		}
	});
});
