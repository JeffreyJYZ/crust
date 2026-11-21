/**
 * The registration gate the three features stand on: a section that opts nothing in must produce no
 * command surface at all, and one that opts a feature in must produce a definition that owns the
 * capability action its docs page names. A name that resolves to nothing is never returned.
 */
import { describe, expect, test } from "bun:test";
import { handlerMap, type PluginContext } from "@/plugins";
import { createPtyPlugin } from "@/plugins/pty";
import { featurePlugins } from "@/runtime-feature-plugins.ts";

const ctx: PluginContext = { emit: () => {} };

describe("feature plugin registration", () => {
	test("no pty section registers no pty command, so nothing can be invoked", async () => {
		const plugins = await featurePlugins({});
		expect(plugins.map((plugin) => plugin.name)).not.toContain("pty");
		expect(handlerMap(plugins).has("pty.open")).toBe(false);
	});

	test("the pty section registers the real commands, not a release stub", async () => {
		const handlers = handlerMap(await featurePlugins({ pty: { shell: "/bin/sh" } }));
		expect([...handlers.keys()].filter((key) => key.startsWith("pty."))).toEqual([
			"pty.open",
			"pty.write",
			"pty.resize",
			"pty.close",
			"pty.list",
		]);
	});

	test("open on POSIX answers a handle, and close ends it", async () => {
		const plugin = createPtyPlugin({ shell: "/bin/sh" }, "darwin");
		const open = await plugin.commands.open({ cols: 90, rows: 20 }, ctx);
		expect(open).toMatchObject({ ok: true });
		const id = (open as { id: string }).id;
		expect(plugin.commands.list().ids).toContain(id);
		expect(plugin.commands.close({ id })).toMatchObject({ ok: true, closed: true, id });
		expect(plugin.commands.list().ids).not.toContain(id);
	});

	test("a page cannot name a program the host did not declare", () => {
		const plugin = createPtyPlugin({ shell: "/bin/sh" }, "darwin");
		const refused = plugin.commands.open({ cols: 80, rows: 24, program: "/bin/zsh" }, ctx);
		expect(refused).toMatchObject({ ok: false, code: "program-not-allowed" });
	});

	test("Windows answers a named not-implemented, never a handle", () => {
		const answer = createPtyPlugin({}, "win32").commands.open({ cols: 80, rows: 24 }, ctx);
		expect(answer).toMatchObject({ ok: false, code: "not-implemented" });
		expect((answer as { requires: string }).requires).toBe("CreatePseudoConsole");
	});

	test("preview and browser still register without their section, owning their own actions", async () => {
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
