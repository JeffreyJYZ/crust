/**
 * A compiled app whose native adapters never loaded must refuse by name, not answer as if the
 * user cancelled or the registry was empty. Two halves: every command on an unadapted plugin
 * answers a typed `not-implemented`, and registration says which namespaces are missing once.
 * A real adapter's genuine empty answer stays exactly what it was.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { configureLogger, resetLogger } from "@/logging";
import { createAccessibilityPlugin } from "./accessibility";
import { createDialogPlugin } from "./dialog";
import { createDockPlugin } from "./dock";
import { isNotImplemented, type PluginDefinition } from "./define";
import { fake as dockFake } from "./dock-fake";
import { nativeGaps, PluginRegistry } from "./registry";
import { createMenuPlugin } from "./menu";
import { createNotificationPlugin } from "./notification";
import { createPowerPlugin } from "./power";
import { fakePower } from "./power-fake";
import { createScreenPlugin } from "./screen";
import { createShortcutsPlugin } from "./shortcuts";
import { createThemePlugin } from "./theme";
import { fake as themeFake } from "./theme-fake";
import { createTrayPlugin } from "./tray";
import { fakeAdapter as trayFake } from "./tray-fake";

const bare = (): PluginDefinition[] => [
	createDialogPlugin(),
	createMenuPlugin(),
	createNotificationPlugin(),
	createTrayPlugin(),
	createShortcutsPlugin(),
	createDockPlugin(),
	createThemePlugin(),
	createScreenPlugin(),
	createPowerPlugin(),
	createAccessibilityPlugin(),
];

const adapted = (): PluginDefinition[] => [
	createDialogPlugin({ pickOpen: async () => ({ paths: [] }) }),
	createMenuPlugin({
		setAppMenu: () => {},
		showContext: () => {},
		reset: () => {},
		onSelect: () => () => {},
	}),
	createNotificationPlugin({ post: () => ({ status: 1, reason: "not authorized" }) }),
	createTrayPlugin(trayFake()),
	createShortcutsPlugin({
		register: () => ({ ok: true, accelerator: "Cmd+A" }),
		unregister: () => true,
		unregisterAll: () => 0,
		onTrigger: () => () => {},
	}),
	createDockPlugin(dockFake().adapter),
	createThemePlugin(themeFake().adapter),
	createScreenPlugin({ adapter: { list: () => [] } }),
	createPowerPlugin(fakePower().adapter),
	createAccessibilityPlugin({
		trusted: () => false,
		prompt: () => false,
		elementCount: () => ({ count: 0, status: 0, reason: "read" }),
	}),
];

const ctx = { emit() {} };

describe("missing native adapters", () => {
	test("an unadapted fake platform refuses every command by name", async () => {
		for (const plugin of bare()) {
			for (const [command, handler] of Object.entries(plugin.commands)) {
				const answer = await handler({}, ctx);
				expect(isNotImplemented(answer), `${plugin.name}.${command}`).toBe(true);
				if (isNotImplemented(answer)) expect(answer.requires.length).toBeGreaterThan(0);
			}
		}
	});

	test("adapted plugins answer their own empty results, unchanged", async () => {
		const all = adapted();
		const dialog = all[0]!;
		const menu = all[1]!;
		const notification = all[2]!;
		const shortcuts = all[4]!;
		const screen = all[7]!;
		expect(await dialog.commands.openPanel!({}, ctx)).toEqual({ paths: [] });
		expect(menu.commands.setAppMenu!({ items: [] }, ctx)).toEqual({ ok: true, count: 0 });
		expect(await notification.commands.notify!({ title: "x" }, ctx)).toEqual({
			delivered: false,
			reason: "not authorized",
		});
		expect(shortcuts.commands.list!({}, ctx)).toEqual([]);
		expect(shortcuts.commands.isRegistered!({ accelerator: "Cmd+A" }, ctx)).toBe(false);
		expect(await screen.commands.list!({}, ctx)).toEqual({ ok: true, screens: [] });
	});

	test("gap report names each missing namespace and its native call", () => {
		const gaps = nativeGaps(bare());
		expect(gaps).toContain("dialog needs NSOpenPanel");
		expect(gaps).toContain("menu needs NSMenu");
		expect(gaps).toContain("notification needs UNUserNotificationCenter");
		expect(gaps).toContain("tray needs NSStatusBar");
		expect(gaps).toContain("shortcut needs RegisterEventHotKey");
		expect(gaps).toContain("dock needs NSDockTile");
		expect(gaps).toContain("theme needs NSAppearance");
		expect(gaps).toContain("accessibility needs AXIsProcessTrusted");
		expect(gaps.length).toBe(10);
		expect(nativeGaps(adapted())).toEqual([]);
	});

	test("registration says the whole set once, loudly", async () => {
		const root = await mkdtemp(join(tmpdir(), "crust-native-gap-"));
		const original = console.error;
		const lines: string[] = [];
		console.error = (...args: unknown[]) => lines.push(args.map(String).join(" "));
		try {
			configureLogger({ root, level: "trace", console: true });
			const plugins = bare();
			new PluginRegistry().register(...plugins);
			new PluginRegistry().register(...plugins);
			expect(lines.length).toBe(1);
			expect(lines[0]).toContain("app.native refused: not-implemented");
			expect(lines[0]).toContain("dialog needs NSOpenPanel");
			expect(lines[0]).toContain("shortcut needs RegisterEventHotKey");
		} finally {
			console.error = original;
			resetLogger();
			await rm(root, { recursive: true, force: true });
		}
	});
});
