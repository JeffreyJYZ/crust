/**
 * The plugin seam's open end: native adapters, `app.use`, and `startApp`.
 *
 * A project plugin is mounted through `app.use`, which refuses a name that would
 * shadow a built-in, and `startApp` puts it in the table the bridge serves, so a
 * page call reaches it over HTTP. The core registry and the honest failures live
 * in `plugins.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { App, type Platform, app as singleton } from "../app";
import { CrustError } from "../bridge/errors";
import type { CrustConfig } from "../config";
import { startApp } from "../runtime";
import { definePlugin, type PluginDefinition } from "./define";
import { createDialogPlugin, dialogPlugin } from "./dialog";
import { createNotificationPlugin, notificationPlugin } from "./notification";
import { createTrayPlugin, trayPlugin } from "./tray";

const ctx = { emit: () => {} };

describe("native adapters", () => {
	test("an adapter turns the same command into real work", async () => {
		const registry = new (await import("./registry")).PluginRegistry().register(
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
