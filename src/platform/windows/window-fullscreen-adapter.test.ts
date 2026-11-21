/**
 * `window.setFullscreen` on Windows, on a machine that is not Windows.
 *
 * Fullscreen is the one style member that keeps state, so what is proved here is the state machine: the
 * pre-fullscreen style and frame are saved, the window covers the monitor, an unrelated resize does not
 * clear the flag, and leaving puts the saved frame back. The flag itself is read back — the record plus
 * the `WS_POPUP` bit — rather than remembered.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { WindowAdapterError, type WindowNative } from "@/plugins/window";
import { createWindowPlugin } from "@/plugins/window.ts";
import { setActiveWindowsPlatform } from "./active-platform.ts";
import { type FakeBackend, fakeBackend } from "./fake-backend.ts";
import { fakeShim } from "./fake-shim.ts";
import { createPlatform } from "./platform.ts";
import { windowsWindowAdapter } from "./window-adapter.ts";
import { windowsFullscreenAdapter } from "./window-fullscreen-adapter.ts";

type Commands = Record<string, (args: unknown) => unknown>;

async function started(options: Parameters<typeof fakeBackend>[0] = {}): Promise<{
	backend: FakeBackend;
	adapter: WindowNative;
	commands: Commands;
}> {
	const backend = fakeBackend(options);
	const platform = createPlatform({ appName: "probe" }, backend);
	await platform.start();
	platform.createWindow({ label: "main", url: "http://127.0.0.1:4123/?window=main" });
	const adapter = windowsWindowAdapter(() => platform);
	return { backend, adapter, commands: createWindowPlugin(adapter).commands as never };
}

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

describe("fullscreen", () => {
	test("saves the frame and covers the monitor, then puts both back", async () => {
		const { backend, commands } = await started();
		expect(commands.setFullscreen?.({ label: "main", value: true })).toMatchObject({
			ok: true,
		});
		expect(commands.isFullscreen?.({ label: "main" })).toMatchObject({ fullscreen: true });
		// The fake's monitor is 1920×1080 and its normal frame 40,60,900×640.
		expect(commands.getSize?.({ label: "main" })).toMatchObject({ width: 1920, height: 1080 });
		expect(commands.setFullscreen?.({ label: "main", value: false })).toMatchObject({
			ok: true,
		});
		expect(commands.isFullscreen?.({ label: "main" })).toMatchObject({ fullscreen: false });
		expect(commands.getSize?.({ label: "main" })).toMatchObject({ width: 900, height: 640 });
		expect(backend.calls).toContain("set_frame:40,60,900,640");
	});

	/** The flag is the saved state plus the popup bit, so a resize must not clear it. */
	test("survives an unrelated resize", async () => {
		const { commands } = await started();
		commands.setFullscreen?.({ label: "main", value: true });
		commands.setSize?.({ label: "main", width: 800, height: 600 });
		expect(commands.isFullscreen?.({ label: "main" })).toMatchObject({ fullscreen: true });
	});

	test("a second setFullscreen(true) does not overwrite the saved frame", async () => {
		const { commands } = await started();
		commands.setFullscreen?.({ label: "main", value: true });
		commands.setFullscreen?.({ label: "main", value: true });
		commands.setFullscreen?.({ label: "main", value: false });
		expect(commands.getPosition?.({ label: "main" })).toMatchObject({ x: 40, y: 60 });
	});

	test("leaving when it was never entered is a no-op, not a move", async () => {
		const { backend, commands } = await started();
		expect(commands.setFullscreen?.({ label: "main", value: false })).toMatchObject({
			ok: true,
		});
		expect(backend.calls.filter((call) => call.startsWith("set_frame:"))).toEqual([]);
	});

	test("a refused frame read is a named failure, not a 0x0 save", async () => {
		const { adapter } = await started({ failFrameRead: true });
		expect(codeOf(() => adapter.setFullscreen?.("main", true))).toBe("handler-error");
	});

	test("the monitor is read before the style is written, so a refusal changes nothing", async () => {
		const { backend, adapter } = await started({ failFrameRead: true });
		expect(codeOf(() => adapter.setFullscreen?.("main", true))).toBe("handler-error");
		expect(backend.calls.filter((call) => call.startsWith("style:"))).toEqual([]);
	});
});

/**
 * Win32 recycles HWNDs. A record keyed only by handle survived a title-bar close and restored the dead
 * window's style and frame onto a new window that inherited the handle.
 */
describe("a fullscreen record whose window was reused", () => {
	test("is dropped instead of restoring a dead window's frame", () => {
		const calls: string[] = [];
		const shim = fakeShim({}, calls);
		let hwnd = 100;
		const adapter = windowsFullscreenAdapter(() => ({ hwnd, shim }));

		adapter.setFullscreen("main", true);
		expect(calls.filter((call) => call.startsWith("style:"))).toHaveLength(1);

		// The old window closed and Win32 handed its handle to a new, ordinary window.
		hwnd = 200;
		calls.length = 0;
		adapter.setFullscreen("main", false);
		expect(calls.filter((call) => call.startsWith("style:"))).toEqual([]);
		expect(calls.filter((call) => call.startsWith("set_frame:"))).toEqual([]);
		expect(adapter.isFullscreen("main")).toBe(false);
	});
});
