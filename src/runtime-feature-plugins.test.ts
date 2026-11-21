/**
 * The registration gate the three features stand on: a section that opts nothing in must produce no
 * command surface at all, and one that opts a feature in must produce a definition that owns the
 * capability action its docs page names. A name that resolves to nothing is never returned.
 */
import { describe, expect, test } from "bun:test";
import { handlerMap, type PluginContext } from "@/plugins";
import { featurePlugins } from "@/runtime-feature-plugins.ts";

const ctx: PluginContext = { emit: () => {} };

describe("feature plugin registration", () => {
	test("no pty section registers no pty command, so nothing can be invoked", async () => {
		const plugins = await featurePlugins({});
		expect(plugins.map((plugin) => plugin.name)).not.toContain("pty");
		expect(handlerMap(plugins).has("pty.open")).toBe(false);
	});

	test("pty: {} registers pty.open, which refuses by name and names the release", async () => {
		const plugins = await featurePlugins({ pty: {} });
		expect(plugins.map((plugin) => plugin.name)).toContain("pty");
		const open = handlerMap(plugins).get("pty.open");
		expect(open).toBeDefined();
		const result = await open?.({}, ctx);
		expect(result).toMatchObject({ ok: false, code: "not-implemented", requires: "0.2.9" });
		expect((result as { message: string }).message).toContain("pty.open");
	});

	test("preview and browser register without their section, owning their own actions", async () => {
		const handlers = handlerMap(await featurePlugins({}));
		expect(handlers.has("preview.show")).toBe(true);
		expect(handlers.has("browser.open")).toBe(true);
	});

	test("every returned definition has a command, so no name resolves to an empty surface", async () => {
		const plugins = await featurePlugins({ pty: {} });
		expect(plugins.map((plugin) => plugin.name)).toEqual(["pty", "preview", "browser"]);
		for (const plugin of plugins)
			expect(Object.keys(plugin.commands).length).toBeGreaterThan(0);
	});

	test("the factory declares no shell command, so a shell grant cannot reach pty", async () => {
		const handlers = handlerMap(await featurePlugins({}));
		expect([...handlers.keys()].filter((key) => key.startsWith("pty."))).toEqual([]);
		expect(handlers.has("shell.spawn")).toBe(false);
	});
});
