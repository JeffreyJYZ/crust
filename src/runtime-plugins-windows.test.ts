/**
 * Which window adapter the registry picks per OS, proven on macOS with the fake Windows backend.
 *
 * The shape this fixes, measured before the change with `nativePlugins([], undefined)` — the exact
 * call the Windows arm made, because `runtime.ts` hands the registry only the darwin platform:
 *
 *   window.setSize     -> {"ok":false,"code":"not-implemented","requires":"NSWindow"}
 *   window.list        -> {"ok":false,"code":"not-implemented","requires":"NSWindow"}
 *   window-state.save  -> {"ok":false,"code":"not-implemented","requires":"NSWindow"}
 *
 * So the Windows failure was a named refusal, not a thrown `TypeError`: no adapter was selected at
 * all. `os` is a parameter here for the same reason `nonDarwinScreenPlugin` takes one — the choice
 * is what is being proved, and no Win32 call is made.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { setActiveWindowsPlatform } from "@/platform/windows/active-platform";
import { fakeBackend } from "@/platform/windows/fake-backend";
import { createPlatform } from "@/platform/windows/platform-factory";
import type { PluginDefinition } from "@/plugins/define";
import { nativePlugins } from "@/runtime-plugins.ts";

type Commands = Record<string, (args: unknown) => unknown>;

/** The commands of one registered plugin, by name. */
async function commandsOf(os: string, name: string): Promise<Commands> {
	const plugins = await nativePlugins([], undefined, { app: "land.jyz.win-registry" }, os);
	const plugin = plugins.find((entry: PluginDefinition) => entry.name === name);
	if (plugin === undefined) throw new Error(`${name} is not registered for ${os}`);
	return plugin.commands as unknown as Commands;
}

/** A started Windows platform with one window open, registered as the process's own. */
async function windowsWindow(): Promise<void> {
	const platform = createPlatform({ appName: "probe" }, fakeBackend());
	await platform.start();
	platform.createWindow({
		label: "main",
		url: "http://127.0.0.1:4123/?window=main",
	});
}

afterEach(() => {
	setActiveWindowsPlatform(undefined);
});

describe("the window adapter the registry picks", () => {
	test("win32 answers a real list, size and position where it used to refuse", async () => {
		await windowsWindow();
		const window = await commandsOf("win32", "window");
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

	test("win32 answers unknown-window for a label nobody opened", async () => {
		await windowsWindow();
		const window = await commandsOf("win32", "window");
		expect(window.setSize?.({ label: "ghost", width: 800, height: 600 })).toMatchObject({
			ok: false,
			code: "unknown-window",
		});
	});

	test("win32 wires window-state's frame calls, so a restore is an answer", async () => {
		await windowsWindow();
		const state = await commandsOf("win32", "window-state");
		// Nothing saved for this label: the frame calls are reached and the answer is "not saved".
		expect(await state.restore?.({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			restored: false,
		});
	});

	/** The one namespace Windows still refuses, and it says why rather than crashing. */
	test("positioner keeps its named refusal on win32", async () => {
		await windowsWindow();
		const positioner = await commandsOf("win32", "positioner");
		expect(await positioner.center?.({ label: "main" })).toMatchObject({
			ok: false,
			code: "not-implemented",
		});
	});

	test("no namespace is registered twice, and window-state is the adapted one", async () => {
		await windowsWindow();
		const plugins = await nativePlugins(
			[],
			undefined,
			{ app: "land.jyz.win-registry" },
			"win32",
		);
		const names = plugins.map((plugin) => plugin.name);
		expect(new Set(names).size).toBe(names.length);
		const state = plugins.find((plugin) => plugin.name === "window-state");
		const answer = await (state?.commands as unknown as Commands).restore?.({ label: "main" });
		// A bare `windowStatePlugin` would answer not-implemented here; the adapted one answers.
		expect(answer).toMatchObject({ ok: true, restored: false });
	});

	/**
	 * Linux used to be pinned here as bare. It now has an arm of its own
	 * (`runtime-plugins-linux.test.ts`), which owns both cases — wired and not-yet-built — because the
	 * active-platform registry is process-wide state and this file must not depend on what an earlier
	 * test file left in it.
	 */
});
