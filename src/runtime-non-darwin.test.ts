/**
 * The non-darwin selection logic, proven on a machine that is neither Linux nor Windows: no shim is
 * compiled and no OS is asked. What is proven is the wiring — the right adapter is chosen per arm,
 * and the seventeen namespaces the darwin branch owns are present on the non-darwin branch with an
 * honest `not-implemented` instead of an `unknown-plugin` that would stop the app booting.
 */

import { describe, expect, test } from "bun:test";
import { CrustError } from "@/bridge/errors";
import { isNotImplemented, type PluginDefinition } from "@/plugins/define";
import type { ScreenRecord } from "@/plugins/screen";
import { PluginRegistry } from "@/plugins/registry";
import { nonDarwinPlugins, nonDarwinScreenPlugin } from "@/runtime-non-darwin";
import { nativePlugins } from "@/runtime-plugins.ts";

/** One command per bare namespace that actually refuses; `deep-link.url` answers null by contract. */
const REFUSALS: ReadonlyArray<readonly [string, string]> = [
	["clipboard", "read"],
	["opener", "openPath"],
	["os", "info"],
	["shortcut", "register"],
	["window-state", "save"],
	["positioner", "center"],
	["menu", "setAppMenu"],
	["theme", "current"],
	["dock", "badge"],
	["accessibility", "trusted"],
	["navigation", "start"],
	["findinpage", "search"],
	["downloads", "list"],
	["network", "rules"],
	["crash-reporter", "last"],
	["i18n", "locale"],
	["deep-link", "scheme"],
];

const DISPLAY: ScreenRecord = {
	id: "0",
	primary: true,
	scale: 1,
	bounds: { x: 0, y: 0, width: 1280, height: 800 },
	workArea: { x: 0, y: 0, width: 1280, height: 770 },
};

async function list(plugin: PluginDefinition<"screen">): Promise<unknown> {
	const handler = plugin.commands["list"];
	if (typeof handler !== "function") throw new Error("screen has no list command");
	return handler({}, { emit() {} });
}

describe("the non-darwin plugin set", () => {
	test("nativePlugins registers every darwin-only namespace by name and once", async () => {
		const plugins = await nativePlugins([], undefined);
		const names = plugins.map((plugin) => plugin.name);
		for (const [name] of REFUSALS) expect(names).toContain(name);
		expect(new Set(names).size).toBe(names.length);
		expect(nonDarwinPlugins.map((plugin) => plugin.name).sort()).toEqual(
			REFUSALS.map(([name]) => name).sort(),
		);
	});

	test("each namespace refuses with not-implemented, never unknown-plugin", async () => {
		const plugins = await nativePlugins([], undefined);
		const registry = new PluginRegistry().register(...plugins);
		for (const [name, command] of REFUSALS) {
			expect(registry.has(name)).toBe(true);
			let refusal: CrustError | undefined;
			try {
				await registry.invoke(name, command, {}, { emit() {} });
			} catch (error) {
				refusal = error as CrustError;
			}
			expect(refusal?.code).toBe("not-implemented");
			expect(refusal?.requires).toBeTruthy();
		}
	});
});

describe("screen selection", () => {
	test("the linux arm uses the GDK adapter, not the bare refusal", async () => {
		const called: string[] = [];
		const plugin = nonDarwinScreenPlugin("linux", {
			linux: {
				list: () => {
					called.push("linux");
					return [DISPLAY];
				},
			},
			windows: {
				list: () => {
					called.push("windows");
					return [];
				},
			},
		});
		expect(await list(plugin)).toMatchObject({ ok: true, screens: [{ id: "0" }] });
		expect(called).toEqual(["linux"]);
	});

	test("the windows arm uses the EnumDisplayMonitors adapter", async () => {
		const called: string[] = [];
		const plugin = nonDarwinScreenPlugin("win32", {
			linux: {
				list: () => {
					called.push("linux");
					return [];
				},
			},
			windows: {
				list: () => {
					called.push("windows");
					return [DISPLAY];
				},
			},
		});
		expect(await list(plugin)).toMatchObject({ ok: true, screens: [{ id: "0" }] });
		expect(called).toEqual(["windows"]);
	});

	test("an OS with no adapter keeps the honest not-implemented refusal", async () => {
		expect(isNotImplemented(await list(nonDarwinScreenPlugin("freebsd")))).toBe(true);
	});
});
