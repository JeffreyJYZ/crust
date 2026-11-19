/**
 * Regression: the non-darwin arm builds `scoped` before the darwin-only dynamic import that used to
 * declare `createFsPlugin`. With `fs.scope` set, `scoped` reached that binding while it was still in
 * its temporal dead zone — `ReferenceError: Cannot access 'createFsPlugin' before initialization` — so
 * every Windows and Linux app with a filesystem scope died at startup (`v0.1.32`). `scoped` must see
 * a `createFsPlugin` that is already initialised on this arm.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { setActiveWindowsPlatform } from "@/platform/windows/active-platform";
import { fakeBackend } from "@/platform/windows/fake-backend";
import { createPlatform } from "@/platform/windows/platform-factory";
import { corePlugins, fsPlugin, type PluginDefinition } from "@/plugins";
import { STATE_FILE, defaultStateRoot } from "@/plugins/window-persist-store";
import { nativePlugins } from "@/runtime-plugins.ts";

/** The registered `fs` plugin after the registry is built with a configured scope. */
async function scopedFs(os: string): Promise<PluginDefinition> {
	const plugins = await nativePlugins(
		corePlugins,
		undefined,
		{ fs: { scope: ["/tmp"] }, app: `land.jyz.fs-scope.${os}` },
		os,
	);
	const plugin = plugins.find((entry) => entry.name === "fs");
	if (plugin === undefined) throw new Error(`fs is not registered for ${os}`);
	return plugin;
}

describe("fs.scope on a platform with no darwin layer", () => {
	test("win32 resolves instead of throwing a TDZ ReferenceError", async () => {
		// Before the fix this reject: createFsPlugin is accessed before its `const` is initialised.
		const fs = await scopedFs("win32");
		expect(fs).toBeDefined();
	});

	test("win32 replaces the core fs with a freshly built plugin", async () => {
		const fs = await scopedFs("win32");
		// `scoped` calls createFsPlugin, which builds a new instance. If it were skipped, the core
		// plugin would come through unchanged — and before the fix, it threw before returning at all.
		expect(fs).not.toBe(fsPlugin);
	});
});

/** A started Windows platform with one window, so the adapted window-state can read a frame. */
async function withWindowsWindow(): Promise<void> {
	const platform = createPlatform({ appName: "probe" }, fakeBackend());
	await platform.start();
	platform.createWindow({ label: "main", url: "http://127.0.0.1:4123/?window=main" });
}

describe("window-state's per-app file", () => {
	/**
	 * All three arms used to call createWindowStatePlugin({ native }) with no app id and no root, so
	 * the plugin fell back to defaultStateRoot("crust"): every crust app saved its geometry into the
	 * same crust/window-state.json (v0.1.32). Two app ids must land in two different files.
	 */
	test("two app ids write two different state files on win32", async () => {
		const savedEnv = process.env.CRUST_DATA_DIR;
		delete process.env.CRUST_DATA_DIR;
		const seed = Date.now();
		const idA = `land.jyz.ws-alpha-${seed}`;
		const idB = `land.jyz.ws-beta-${seed}`;
		const rootA = defaultStateRoot(idA);
		const rootB = defaultStateRoot(idB);
		try {
			await withWindowsWindow();
			for (const id of [idA, idB]) {
				const plugins = await nativePlugins([], undefined, { app: id }, "win32");
				const state = plugins.find((plugin) => plugin.name === "window-state");
				if (state === undefined) throw new Error("window-state is not registered");
				const commands = state.commands as unknown as Record<
					string,
					(args: unknown) => Promise<unknown>
				>;
				expect(await commands.save?.({ label: "main" })).toMatchObject({ ok: true });
			}
			expect(rootA).not.toBe(rootB);
			expect(await Bun.file(join(rootA, STATE_FILE)).exists()).toBe(true);
			expect(await Bun.file(join(rootB, STATE_FILE)).exists()).toBe(true);
		} finally {
			setActiveWindowsPlatform(undefined);
			await rm(rootA, { recursive: true, force: true });
			await rm(rootB, { recursive: true, force: true });
			if (savedEnv !== undefined) process.env.CRUST_DATA_DIR = savedEnv;
		}
	});
});
