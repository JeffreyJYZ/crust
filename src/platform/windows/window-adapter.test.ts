/**
 * The Windows window adapter, driven on a machine that is not Windows: a real `WindowsPlatform` with
 * the fake backend, so every label, handle and prune is the platform's own and only user32 is fake.
 *
 * What this proves is the wiring and the rules the contract carries — a ghost label is
 * `unknown-window`, a live one is refused as `duplicate-label`, and `setSize` then `getSize` is one
 * frame — not that Win32 answers. The `SetWindowPos` call itself is read-from-code until the
 * `windows-arm-runtime` workflow runs against a real HWND.
 *
 * The optional members (state and chrome) are driven through the plugin's own commands, which is the
 * surface a page sees, so an absent member answers its typed failure instead of throwing here. The
 * states this file does not cover — minimised, maximised, unreadable frame — are
 * `window-state-adapter.test.ts`, and the style members are `window-style-adapter.test.ts`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { WindowAdapterError, type WindowNative } from "@/plugins/window";
import { createWindowPlugin } from "@/plugins/window.ts";
import { setActiveWindowsPlatform } from "./active-platform.ts";
import { type FakeBackend, fakeBackend } from "./fake-backend.ts";
import { createPlatform, type WindowsPlatform } from "./platform.ts";
import { windowsWindowAdapter } from "./window-adapter.ts";

/** The plugin's command table: every command is required, unlike the adapter's optional members. */
type Commands = Record<string, (args: unknown) => unknown>;

/** A started platform with one window open, which is the state every command expects. */
async function started(options: Parameters<typeof fakeBackend>[0] = {}): Promise<{
	platform: WindowsPlatform;
	backend: FakeBackend;
	adapter: WindowNative;
	commands: Commands;
}> {
	const backend = fakeBackend(options);
	const platform = createPlatform({ appName: "probe" }, backend);
	await platform.start();
	platform.createWindow({ label: "main", url: "http://127.0.0.1:4123/?window=main" });
	const adapter = windowsWindowAdapter(() => platform);
	return { platform, backend, adapter, commands: createWindowPlugin(adapter).commands as never };
}

/** The typed code an adapter throw carries; a plain Error would be a contract defect. */
function codeOf(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		if (error instanceof WindowAdapterError) return error.code;
		throw error;
	}
	throw new Error("the adapter did not throw");
}

afterEach(() => {
	setActiveWindowsPlatform(undefined);
});

describe("the Windows window adapter", () => {
	test("list and isOpen read the platform's own labels", async () => {
		const { adapter } = await started();
		expect(adapter.list()).toEqual(["main"]);
		expect(adapter.isOpen("main")).toBe(true);
	});

	/**
	 * The brief's own case: a ghost label used to be a TypeError when a darwin closure reached an
	 * undefined platform. It is now `unknown-window` at the adapter and at the command, which is what
	 * a page can branch on.
	 */
	test("setSize on a label that does not exist answers unknown-window, never a TypeError", async () => {
		const { adapter, commands } = await started();
		expect(commands.setSize?.({ label: "ghost", width: 800, height: 600 })).toMatchObject({
			ok: false,
			code: "unknown-window",
		});
		// The adapter alone refuses it the same way, so the answer does not depend on the gate.
		expect(codeOf(() => adapter.close("ghost"))).toBe("unknown-window");
	});

	test("setSize then getSize is one frame, and the origin is preserved", async () => {
		const { backend, commands } = await started();
		expect(commands.setSize?.({ label: "main", width: 800, height: 600 })).toMatchObject({
			ok: true,
			width: 800,
			height: 600,
		});
		expect(commands.getSize?.({ label: "main" })).toMatchObject({ width: 800, height: 600 });
		expect(commands.getPosition?.({ label: "main" })).toMatchObject({ x: 40, y: 60 });
		expect(backend.calls).toContain("set_frame:40,60,800,600");
	});

	test("setPosition keeps the size it read back", async () => {
		const { backend, commands } = await started();
		expect(commands.setPosition?.({ label: "main", x: 10, y: 20 })).toMatchObject({ ok: true });
		expect(commands.getPosition?.({ label: "main" })).toMatchObject({ x: 10, y: 20 });
		expect(backend.calls).toContain("set_frame:10,20,900,640");
	});

	test("a refused SetWindowPos is a typed failure, not a silent no-op", async () => {
		const { commands } = await started({ failFrame: true });
		expect(commands.setSize?.({ label: "main", width: 1, height: 1 })).toMatchObject({
			ok: false,
			code: "handler-error",
		});
	});

	test("minimize, maximize and restore are ShowWindow verbs, and read back", async () => {
		const { backend, commands } = await started({ minimized: true, maximized: true });
		expect(commands.minimize?.({ label: "main" })).toMatchObject({ ok: true });
		expect(commands.unminimize?.({ label: "main" })).toMatchObject({ ok: true });
		expect(commands.maximize?.({ label: "main" })).toMatchObject({ ok: true });
		expect(backend.calls.filter((call) => call.startsWith("show:"))).toEqual([
			"show:0",
			"show:2",
			"show:1",
		]);
		expect(commands.isMinimized?.({ label: "main" })).toMatchObject({ minimized: true });
		expect(commands.isMaximized?.({ label: "main" })).toMatchObject({ maximized: true });
	});

	test("focus reports Windows' foreground lock instead of claiming a raise", async () => {
		const { adapter } = await started({ failFocus: true });
		expect(codeOf(() => adapter.focus("main"))).toBe("handler-error");
	});

	test("create refuses a label the platform still holds", async () => {
		const { commands } = await started();
		expect(commands.create?.({ label: "main" })).toMatchObject({
			ok: false,
			code: "duplicate-label",
		});
	});

	test("create resolves a relative url against the app's own document", async () => {
		const { backend, commands } = await started();
		expect(commands.create?.({ label: "second", url: "/about?window=second" })).toMatchObject({
			ok: true,
			label: "second",
		});
		expect(backend.calls).toContain("webview_new:http://127.0.0.1:4123/about?window=second");
	});

	test("close prunes the label, so the same label can be created again", async () => {
		const { adapter, commands } = await started();
		expect(commands.close?.({ label: "main" })).toMatchObject({ ok: true, closed: true });
		expect(adapter.list()).toEqual([]);
		expect(codeOf(() => adapter.isOpen("main"))).toBe("unknown-window");
		// A relative url needs a window that has loaded one to resolve against; with the last window
		// gone that is a named refusal, and an absolute url still creates.
		expect(commands.create?.({ label: "main" })).toMatchObject({
			ok: false,
			code: "handler-error",
		});
		expect(commands.create?.({ label: "main", url: "http://127.0.0.1:4123/" })).toMatchObject({
			ok: true,
			label: "main",
		});
	});

	/** The refusals are gone: every member the plugin's `WINDOW_COMMANDS` names is answered here. */
	test("the members that used to refuse are wired, and each answers through the plugin", async () => {
		const { adapter, commands } = await started();
		for (const member of [
			"setAlwaysOnTop",
			"isAlwaysOnTop",
			"setFullscreen",
			"isFullscreen",
			"setDecorations",
			"isDecorated",
			"setOpacity",
			"opacity",
			"setCursor",
			"setCursorVisible",
		] as const) {
			expect(adapter[member]).toBeTypeOf("function");
		}
		expect(commands.setAlwaysOnTop?.({ label: "main", value: true })).toMatchObject({
			ok: true,
		});
		expect(commands.setOpacity?.({ label: "main", value: 0.5 })).toMatchObject({ ok: true });
		expect(commands.setCursor?.({ cursor: "text" })).toMatchObject({ ok: true });
	});

	test("no platform attached is a named refusal, not a crash", () => {
		const adapter = windowsWindowAdapter(() => undefined);
		expect(codeOf(() => adapter.list())).toBe("unknown-adapter");
	});
});
