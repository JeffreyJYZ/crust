/**
 * `crust:shortcut` proofs that need no hot key: the grammar, the registry and the emit path, each against a fake adapter. The Carbon half has its own suite in `platform/darwin/shortcuts.test.ts`, so nothing here registers a real hot key and the suite never swallows a key on the machine it runs on.
 */

import { describe, expect, test } from "bun:test";
import { isNotImplemented, type PluginContext } from "@/plugins/define.ts";
import {
	AcceleratorError,
	createShortcutsPlugin,
	type ParsedAccelerator,
	parseAccelerator,
	type ShortcutAdapter,
} from "@/plugins/shortcuts.ts";

/** The context the bridge always passes; nothing here is pushed to a page. */
const quiet: PluginContext = { emit: () => undefined };

function fakeAdapter(): {
	adapter: ShortcutAdapter;
	registered: Map<string, ParsedAccelerator>;
	fire(accelerator: string): void;
} {
	const registered = new Map<string, ParsedAccelerator>();
	let handler: ((accelerator: string) => void) | undefined;
	return {
		registered,
		adapter: {
			register(parsed) {
				registered.set(parsed.accelerator, parsed);
				return { ok: true, accelerator: parsed.accelerator };
			},
			unregister: (parsed) => registered.delete(parsed.accelerator),
			unregisterAll() {
				const count = registered.size;
				registered.clear();
				return count;
			},
			onTrigger(next) {
				handler = next;
				return () => {
					handler = undefined;
				};
			},
		},
		fire: (accelerator: string) => handler?.(accelerator),
	};
}

const refused: ShortcutAdapter = {
	register: () => ({ ok: false, code: "native-failed", message: "RegisterEventHotKey refused" }),
	unregister: () => false,
	unregisterAll: () => 0,
	onTrigger: () => () => undefined,
};

/** The `part` of the accelerator a call refused, so a failure names its own token. */
function refusedPart(text: string): string | undefined {
	try {
		parseAccelerator(text);
		return undefined;
	} catch (error) {
		return (error as AcceleratorError).part;
	}
}

describe("accelerator grammar", () => {
	test("aliases collapse to one canonical spelling", () => {
		expect(parseAccelerator("CommandOrControl+Shift+K")).toEqual({
			accelerator: "command+shift+k",
			key: "k",
			modifiers: ["command", "shift"],
		});
		for (const spelling of ["Cmd+Shift+K", "  cmd + shift + k ", "Super+Shift+K"]) {
			expect(parseAccelerator(spelling).accelerator).toBe("command+shift+k");
		}
		expect(parseAccelerator("Ctrl+Alt+Space")).toEqual({
			accelerator: "control+option+space",
			key: "space",
			modifiers: ["control", "option"],
		});
		expect(parseAccelerator("F12")).toEqual({ accelerator: "f12", key: "f12", modifiers: [] });
		expect(parseAccelerator("Option+F5").accelerator).toBe("option+f5");
		expect(parseAccelerator("Escape").accelerator).toBe("escape");
	});

	test("an unknown modifier, a repeat, an unknown key and an empty token each name themselves", () => {
		expect(refusedPart("Cmd+Shift+Hyper+K")).toBe("Hyper");
		expect(refusedPart("Cmd+Cmd+K")).toBe("Cmd");
		expect(refusedPart("Cmd+Nope")).toBe("Nope");
		expect(refusedPart("Cmd+")).toBe("");
		expect(refusedPart("")).toBe("accelerator");
		expect(() => parseAccelerator("Cmd+Nope")).toThrow(AcceleratorError);
	});
});

describe("shortcut plugin against a fake adapter", () => {
	test("register reaches the adapter and list/isRegistered agree", async () => {
		const fake = fakeAdapter();
		const plugin = createShortcutsPlugin(fake.adapter);
		expect(await plugin.commands.register({ accelerator: "Cmd+Shift+K" }, quiet)).toEqual({
			ok: true,
			accelerator: "command+shift+k",
		});
		expect(plugin.commands.list()).toEqual(["command+shift+k"]);
		expect(plugin.commands.isRegistered({ accelerator: "CMD+SHIFT+K" })).toBe(true);
		expect(plugin.commands.isRegistered({ accelerator: "Cmd+J" })).toBe(false);
	});

	test("a second registration of one accelerator is refused, not re-registered", async () => {
		const fake = fakeAdapter();
		const plugin = createShortcutsPlugin(fake.adapter);
		await plugin.commands.register({ accelerator: "Cmd+K" }, quiet);
		expect(await plugin.commands.register({ accelerator: "command+k" }, quiet)).toEqual({
			ok: false,
			code: "already-registered",
			message: "shortcut.register: command+k is already registered",
			part: "command+k",
		});
		expect(fake.registered.size).toBe(1);
	});

	test("a malformed accelerator is a bad-accelerator result naming the part", async () => {
		const fake = fakeAdapter();
		const plugin = createShortcutsPlugin(fake.adapter);
		const result = await plugin.commands.register({ accelerator: "Cmd+Shift+Hyper" }, quiet);
		if (result.ok || result.code !== "bad-accelerator") {
			throw new Error("expected a bad-accelerator refusal");
		}
		expect(result.part).toBe("Hyper");
		expect(fake.registered.size).toBe(0);
		// An adapter's own refusal passes through unchanged, and nothing is recorded.
		const refusedPlugin = createShortcutsPlugin(refused);
		expect(await refusedPlugin.commands.register({ accelerator: "Cmd+K" }, quiet)).toEqual({
			ok: false,
			code: "native-failed",
			message: "RegisterEventHotKey refused",
		});
		expect(refusedPlugin.commands.list()).toEqual([]);
	});

	test("unregister and unregisterAll keep the registry honest", async () => {
		const fake = fakeAdapter();
		const plugin = createShortcutsPlugin(fake.adapter);
		await plugin.commands.register({ accelerator: "Cmd+K" }, quiet);
		await plugin.commands.register({ accelerator: "Cmd+J" }, quiet);
		expect(await plugin.commands.unregister({ accelerator: "cmd+k" }, quiet)).toEqual({
			ok: true,
			accelerator: "command+k",
		});
		expect(plugin.commands.list()).toEqual(["command+j"]);
		expect(await plugin.commands.unregister({ accelerator: "Cmd+K" }, quiet)).toEqual({
			ok: false,
			code: "not-registered",
			message: "shortcut.unregister: command+k is not registered",
			part: "command+k",
		});
		expect(await plugin.commands.unregisterAll()).toEqual({ removed: 1 });
		expect(plugin.commands.list()).toEqual([]);
	});

	test("a press reaches the page as emit('shortcut', { accelerator })", async () => {
		const fake = fakeAdapter();
		const plugin = createShortcutsPlugin(fake.adapter);
		const emitted: Array<[string, unknown]> = [];
		const ctx: PluginContext = {
			emit: (event: string, data: unknown) => emitted.push([event, data]),
		};
		await plugin.commands.register({ accelerator: "CommandOrControl+Shift+K" }, ctx);
		// Registering is not a press: the page hears nothing until the hot key fires.
		expect(emitted).toEqual([]);
		fake.fire("command+shift+k");
		expect(emitted).toEqual([["shortcut", { accelerator: "command+shift+k" }]]);
	});
});

describe("shortcut plugin without an adapter", () => {
	test("every command that needs the OS answers a typed NotImplemented", async () => {
		const plugin = createShortcutsPlugin();
		for (const result of [
			await plugin.commands.register({ accelerator: "Cmd+K" }, quiet),
			await plugin.commands.unregister({ accelerator: "Cmd+K" }, quiet),
			await plugin.commands.unregisterAll(),
		]) {
			expect(isNotImplemented(result)).toBe(true);
			if (isNotImplemented(result)) expect(result.requires).toBe("RegisterEventHotKey");
		}
		expect(plugin.commands.list()).toEqual([]);
		expect(plugin.commands.isRegistered({ accelerator: "Cmd+K" })).toBe(false);
	});
});
