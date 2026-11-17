/**
 * `crust:shortcut` proofs for the two paths the adapter contract exposes but the plugin used to lose:
 * a native unregister that refuses (the registry must keep the key) and the unsubscribe from
 * `onTrigger` (the plugin must retain it and expose a way to call it).
 */

import { describe, expect, test } from "bun:test";

import type { PluginContext } from "@/plugins/define";
import { createShortcutsPlugin, type ShortcutAdapter } from "@/plugins/shortcuts";

const quiet: PluginContext = { emit: () => undefined };

function fake(refuseUnregister = false) {
	const os = new Set<string>();
	const calls: string[] = [];
	let handler: ((accelerator: string) => void) | undefined;
	let detached = 0;
	const adapter: ShortcutAdapter = {
		register: (parsed) => {
			os.add(parsed.accelerator);
			return { ok: true, accelerator: parsed.accelerator };
		},
		unregister: (parsed) => {
			calls.push(parsed.accelerator);
			if (refuseUnregister) return false;
			return os.delete(parsed.accelerator);
		},
		unregisterAll: () => {
			const count = os.size;
			os.clear();
			return count;
		},
		onTrigger: (next) => {
			handler = next;
			return () => {
				handler = undefined;
				detached += 1;
			};
		},
	};
	return { adapter, os, calls, fire: (a: string) => handler?.(a), detached: () => detached };
}

describe("shortcut native failures", () => {
	test("a refused native unregister keeps the key in the registry and retries the OS", async () => {
		const os = fake(true);
		const plugin = createShortcutsPlugin(os.adapter);
		await plugin.commands.register({ accelerator: "Cmd+K" }, quiet);

		const result = await plugin.commands.unregister({ accelerator: "cmd+k" }, quiet);
		expect(result).toMatchObject({ ok: false, code: "native-failed" });
		expect(plugin.commands.list()).toEqual(["command+k"]);
		expect(plugin.commands.isRegistered({ accelerator: "Cmd+K" })).toBe(true);
		expect(os.os.has("command+k")).toBe(true);

		await plugin.commands.unregister({ accelerator: "Cmd+K" }, quiet);
		expect(os.calls).toEqual(["command+k", "command+k"]);
	});

	test("dispose detaches the press handler once, so a fired key reaches nobody", async () => {
		const os = fake();
		const plugin = createShortcutsPlugin(os.adapter);
		const emitted: unknown[] = [];
		await plugin.commands.register(
			{ accelerator: "Cmd+J" },
			{ emit: (_event, data) => emitted.push(data) },
		);
		os.fire("command+j");
		expect(emitted).toEqual([{ accelerator: "command+j" }]);

		plugin.dispose();
		os.fire("command+j");
		expect(emitted).toEqual([{ accelerator: "command+j" }]);
		expect(os.detached()).toBe(1);
		plugin.dispose();
		expect(os.detached()).toBe(1);
	});
});
