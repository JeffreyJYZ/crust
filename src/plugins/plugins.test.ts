/**
 * Plugin seam proofs.
 *
 * The four core plugins share one mechanism. `fs` works; the three that need
 * AppKit or `UNUserNotificationCenter` fail honestly with a code and the
 * selector they are waiting on, which is the whole point of the typed
 * `NotImplemented`.
 *
 * The last two groups prove the seam is open: `app.use` mounts a project's own
 * plugin and refuses a name that would shadow a built-in, and `startApp` puts
 * that plugin in the table the bridge serves, so a page call reaches it.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App, type Platform, app as singleton } from "../app";
import { CrustError } from "../bridge/errors";
import type { CrustConfig } from "../config";
import { startApp } from "../runtime";
import { definePlugin, type PluginDefinition } from "./define";
import { createDialogPlugin, dialogPlugin } from "./dialog";
import { fsPlugin } from "./fs";
import { corePlugins, coreRegistry } from "./index";
import { createNotificationPlugin, notificationPlugin } from "./notification";
import { PluginRegistry } from "./registry";
import { createTrayPlugin, trayPlugin } from "./tray";

const temps: string[] = [];

afterEach(async () => {
	while (temps.length > 0) await rm(temps.pop() as string, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "crust-plugins-"));
	temps.push(dir);
	return dir;
}

const ctx = { emit: () => {} };

describe("definePlugin", () => {
	test("refuses a dotted name, an empty name and a commandless plugin", () => {
		expect(() => definePlugin({ name: "a.b", commands: { x: () => 1 } })).toThrow(CrustError);
		expect(() => definePlugin({ name: "", commands: { x: () => 1 } })).toThrow(CrustError);
		expect(() => definePlugin({ name: "empty", commands: {} })).toThrow(CrustError);
	});

	test("is frozen once declared", () => {
		const plugin = definePlugin({ name: "frozen", commands: { x: () => 1 } });
		expect(Object.isFrozen(plugin)).toBe(true);
		expect(Object.isFrozen(plugin.commands)).toBe(true);
	});
});

describe("registry", () => {
	test("registers the four core plugins and runs fs end to end", async () => {
		const registry = coreRegistry();
		expect(registry.names()).toEqual(["fs", "dialog", "notification", "tray"]);
		expect(registry.size).toBe(4);
		expect(corePlugins.length).toBe(4);

		const dir = await tempDir();
		const path = join(dir, "note.txt");
		const written = await registry.invoke(
			"fs",
			"writeTextFile",
			{ path, contents: "hello crust" },
			ctx,
		);
		expect((written as { bytes: number }).bytes).toBe("hello crust".length);
		const read = await registry.invoke("fs", "readTextFile", { path }, ctx);
		expect(read).toBe("hello crust");
	});

	test("a missing file is a not-found CrustError", async () => {
		const registry = coreRegistry();
		await expect(
			registry.invoke("fs", "readTextFile", { path: "/definitely/not/here.txt" }, ctx),
		).rejects.toMatchObject({ code: "not-found" });
	});

	test("unknown plugin and unknown command are different codes", async () => {
		const registry = coreRegistry();
		await expect(registry.invoke("nope", "x", {}, ctx)).rejects.toMatchObject({
			code: "unknown-plugin",
		});
		await expect(registry.invoke("fs", "nope", {}, ctx)).rejects.toMatchObject({
			code: "unknown-command",
		});
	});

	test("a duplicate registration is refused rather than replaced", () => {
		const registry = new PluginRegistry().register(fsPlugin);
		expect(() => registry.register(fsPlugin)).toThrow(CrustError);
	});

	test("handlers() is keyed plugin.command", () => {
		const keys = [...coreRegistry().handlers().keys()];
		expect(keys).toContain("fs.readTextFile");
		expect(keys).toContain("dialog.openPanel");
		expect(keys.every((key) => key.includes("."))).toBe(true);
	});
});

describe("honest failures", () => {
	test("dialog.openPanel names NSOpenPanel instead of resolving an empty list", async () => {
		const registry = coreRegistry();
		await expect(registry.invoke("dialog", "openPanel", {}, ctx)).rejects.toMatchObject({
			code: "not-implemented",
			requires: "NSOpenPanel",
		});
	});

	test("notification names UNUserNotificationCenter", async () => {
		const registry = coreRegistry();
		for (const command of ["requestPermission", "notify"]) {
			await expect(
				registry.invoke("notification", command, { title: "x" }, ctx),
			).rejects.toMatchObject({
				code: "not-implemented",
				requires: "UNUserNotificationCenter",
			});
		}
	});

	test("tray names NSStatusBar", async () => {
		const registry = coreRegistry();
		const calls: [string, Record<string, unknown>][] = [
			["setTitle", { text: "x" }],
			["setMenu", { items: [] }],
			["show", {}],
			["hide", {}],
			["destroy", {}],
		];
		for (const [command, args] of calls) {
			await expect(registry.invoke("tray", command, args, ctx)).rejects.toMatchObject({
				code: "not-implemented",
				requires: "NSStatusBar",
			});
		}
	});
});

describe("native adapters", () => {
	test("an adapter turns the same command into real work", async () => {
		const registry = new PluginRegistry().register(
			createDialogPlugin({ pickOpen: async () => ({ paths: ["/tmp/one"] }) }),
			createNotificationPlugin({
				requestPermission: async () => "granted",
				notify: async () => ({ id: "n1" }),
			}),
			createTrayPlugin({
				setTitle: () => {},
				setMenu: () => {},
				show: () => {},
				hide: () => {},
				destroy: () => {},
			}),
		);

		expect(await registry.invoke("dialog", "openPanel", { multiple: false }, ctx)).toEqual({
			paths: ["/tmp/one"],
		});
		expect(await registry.invoke("notification", "requestPermission", {}, ctx)).toBe("granted");
		expect(await registry.invoke("notification", "notify", { title: "hi" }, ctx)).toEqual({
			id: "n1",
		});
		expect(await registry.invoke("tray", "setTitle", { text: "hi" }, ctx)).toMatchObject({
			ok: true,
		});
	});

	test("the defaults stand in for every adapter", () => {
		expect(dialogPlugin.name).toBe("dialog");
		expect(notificationPlugin.name).toBe("notification");
		expect(trayPlugin.name).toBe("tray");
	});
});

/** A platform that does nothing, so `run()` can be exercised without AppKit. */
function fakePlatform(): Platform {
	return {
		start: async () => {},
		pump: () => {},
		createWindow: (options) => ({ label: options.label }),
		window: () => undefined,
		quit: () => {},
	};
}

const testConfig: CrustConfig = {
	app: { id: "land.jyz.plugin-test", name: "plugin test", version: "0.0.0" },
	windows: [],
};

const clock = definePlugin({ name: "clock", commands: { now: () => "now" } });

function mount(target: App, value: unknown): App {
	return target.use(value as PluginDefinition);
}

describe("app.use", () => {
	test("refuses anything that is not a plugin definition", () => {
		const app = new App();
		expect(() => mount(app, null)).toThrow(/not a plugin definition/);
		expect(() => mount(app, { name: "", commands: { x: () => 1 } })).toThrow(CrustError);
		expect(() => mount(app, { name: "a.b", commands: { x: () => 1 } })).toThrow(/dot/);
		expect(() => mount(app, { name: "no-commands" })).toThrow(/commands object/);
		expect(() => mount(app, { name: "empty", commands: {} })).toThrow(/no commands/);
		expect(() => mount(app, { name: "x", commands: { y: 1 } })).toThrow(/not a function/);
	});

	test("refuses every built-in name instead of shadowing it", () => {
		for (const name of ["fs", "dialog", "notification", "tray", "window"]) {
			expect(() => mount(new App(), { name, commands: { x: () => 1 } })).toThrow(name);
		}
		expect(() => mount(new App(), { name: "app", commands: { x: () => 1 } })).toThrow(
			/reserved app namespace/,
		);
	});

	test("refuses a second mount of the same name", () => {
		const app = new App().use(clock);
		expect(() => app.use(clock)).toThrow(/already mounted/);
	});

	test("mounts a frozen definition, in order", () => {
		const app = new App().use(clock);
		expect(app.plugins().map((plugin) => plugin.name)).toEqual(["clock"]);
		expect(Object.isFrozen(app.plugins()[0])).toBe(true);
		expect(Object.isFrozen(app.plugins()[0]?.commands)).toBe(true);
	});

	test("is refused once run() has started, the same way command() is", async () => {
		const app = new App().attach(fakePlatform(), testConfig);
		await app.run();
		expect(() => app.use(clock)).toThrow(/app\.run\(\)/);
		expect(() => app.command("late", () => 1)).toThrow(/app\.run\(\)/);
	});
});

describe("startApp", () => {
	test("mounts project plugins after the built-ins and serves them", async () => {
		const greeting = definePlugin({
			name: "greeting",
			commands: { greet: ({ name }: { name: string }) => `hello ${name}, from a plugin` },
		});
		const bridge = await startApp({
			config: { ...testConfig, windows: [{ label: "main", url: "/" }] },
			attachPlatform: false,
			entryModule: async () => {
				singleton.use(greeting);
			},
		});

		try {
			const response = await fetch(`${bridge.url}/_crust/invoke`, {
				method: "POST",
				headers: {
					origin: bridge.url,
					authorization: `Bearer ${bridge.token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					plugin: "greeting",
					command: "greet",
					args: { name: "jyz" },
				}),
			});
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				ok: true,
				result: "hello jyz, from a plugin",
			});
		} finally {
			await bridge.stop();
		}
	});
});
