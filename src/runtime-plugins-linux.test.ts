/**
 * The linux arm of the window-adapter registry, proved on macOS through the fake shim.
 *
 * There is no GTK on this machine, so what is measured is the *choice* — that `os = "linux"` now
 * registers an adapted `window` and `window-state` — and the adapter's own answers over recorded
 * state. No display behaviour is claimed. The shape this fixes, measured before the wiring with
 * `nativePlugins([], undefined, { app }, "linux")`:
 *
 *   window.setSize     -> {"ok":false,"code":"not-implemented","requires":"NSWindow"}
 *   window.list        -> {"ok":false,"code":"not-implemented","requires":"NSWindow"}
 *   window-state.save  -> {"ok":false,"code":"not-implemented","requires":"NSWindow"}
 */
import { afterEach, describe, expect, test } from "bun:test";
import { setActiveLinuxPlatform } from "@/platform/linux/active-platform";
import { openFake } from "@/platform/linux/window-fake";
import type { PluginDefinition } from "@/plugins/define";
import { nativePlugins } from "@/runtime-plugins.ts";

type Commands = Record<string, (args: unknown) => unknown>;

/** Every plugin registered for linux, one call each, so a test can inspect the whole set. */
async function linuxPlugins(): Promise<PluginDefinition[]> {
	return nativePlugins([], undefined, { app: "land.jyz.linux-registry" }, "linux");
}

/** The commands of one registered plugin, by name. */
async function commandsOf(name: string): Promise<Commands> {
	const plugin = (await linuxPlugins()).find((entry) => entry.name === name);
	if (plugin === undefined) throw new Error(`${name} is not registered for linux`);
	return plugin.commands as unknown as Commands;
}

/** A started Linux platform with one window open, registered as the process's own. */
async function linuxWindow(): Promise<void> {
	const { platform, shim } = await openFake();
	platform.createWindow({
		label: "main",
		url: "http://127.0.0.1:4123/?window=main",
	});
	setActiveLinuxPlatform({ platform, native: shim.symbols });
}

afterEach(() => {
	setActiveLinuxPlatform(undefined);
});

describe("the linux window adapter", () => {
	test("linux answers a real list, size and position where it used to refuse", async () => {
		await linuxWindow();
		const window = await commandsOf("window");
		expect(window.list?.({})).toEqual({ ok: true, labels: ["main"] });
		expect(window.setSize?.({ label: "main", width: 800, height: 600 })).toMatchObject({
			ok: true,
			width: 800,
			height: 600,
		});
		expect(window.getSize?.({ label: "main" })).toMatchObject({
			ok: true,
			width: 800,
			height: 600,
		});
		expect(window.setPosition?.({ label: "main", x: 10, y: 20 })).toMatchObject({
			ok: true,
			x: 10,
			y: 20,
		});
	});

	test("linux answers unknown-window for a label nobody opened", async () => {
		await linuxWindow();
		const window = await commandsOf("window");
		expect(window.setSize?.({ label: "ghost", width: 800, height: 600 })).toMatchObject({
			ok: false,
			code: "unknown-window",
		});
	});

	test("linux wires window-state's frame calls, so a restore is an answer", async () => {
		await linuxWindow();
		const state = await commandsOf("window-state");
		expect(await state.restore?.({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			restored: false,
		});
	});

	/** `positioner` is the one namespace Linux still refuses: see `ADAPTED` in the registry. */
	test("positioner keeps the bare refusal on linux, so nothing lands on the wrong edge", async () => {
		await linuxWindow();
		const positioner = await commandsOf("positioner");
		expect(await positioner.center?.({ label: "main" })).toMatchObject({
			ok: false,
			code: "not-implemented",
			requires: "NSWindow",
		});
	});

	test("no namespace is registered twice, and window-state is the adapted one", async () => {
		await linuxWindow();
		const plugins = await linuxPlugins();
		const names = plugins.map((plugin) => plugin.name);
		expect(new Set(names).size).toBe(names.length);
		const state = plugins.find((plugin) => plugin.name === "window-state");
		// A bare `windowStatePlugin` would answer not-implemented here; the adapted one answers.
		expect(
			await (state?.commands as unknown as Commands).restore?.({
				label: "main",
			}),
		).toMatchObject({ ok: true, restored: false });
	});
});

describe("a linux run that built no platform", () => {
	test("keeps the bare refusals, and window-state is still registered", async () => {
		// Cleared explicitly: the registry is process-wide state, and another test file's
		// `loadPlatform("linux")` leaves a platform behind, so this case must state its own world.
		setActiveLinuxPlatform(undefined);
		const window = await commandsOf("window");
		expect(window.setSize?.({ label: "main", width: 800, height: 600 })).toMatchObject({
			ok: false,
			code: "not-implemented",
		});
		// The bare namespace is only dropped when an adapter replaced it, so it must still be here.
		const names = (await linuxPlugins()).map((plugin) => plugin.name);
		expect(names).toContain("window-state");
		expect(names).toContain("positioner");
	});
});
