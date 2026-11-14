/**
 * Plugin seam proofs. The four core plugins share one mechanism: `fs` works, and the three needing AppKit or `UNUserNotificationCenter` fail honestly with a code and the selector they wait on — the whole point of the typed `NotImplemented`.
 * The mount seam lives in `plugins-mount.test.ts`: `app.use` refuses a name that would shadow a built-in, and `startApp` puts the mounted plugin in the table the bridge serves.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CrustError } from "../bridge/errors";
import { definePlugin } from "./define";
import { fsPlugin } from "./fs";
import { corePlugins, coreRegistry } from "./index";
import { PluginRegistry } from "./registry";

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
