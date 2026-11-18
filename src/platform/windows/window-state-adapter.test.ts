/**
 * The state half on Windows, on the states the first pass did not think about: a minimised window, a
 * maximised one, and a handle whose frame cannot be read at all.
 *
 * Each of these was a defect in `47415e1` rather than a missing feature, which is why they are here as
 * their own file: the geometry code was right for a window in its normal state and wrong for every
 * other one.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { WindowAdapterError, type WindowNative } from "@/plugins/window";
import { createWindowPlugin } from "@/plugins/window.ts";
import { setActiveWindowsPlatform } from "./active-platform.ts";
import { type FakeBackend, fakeBackend } from "./fake-backend.ts";
import { createPlatform } from "./platform.ts";
import { windowsWindowAdapter } from "./window-adapter.ts";

type Commands = Record<string, (args: unknown) => unknown>;

async function started(options: Parameters<typeof fakeBackend>[0] = {}): Promise<{
	backend: FakeBackend;
	adapter: WindowNative;
	commands: Commands;
}> {
	const backend = fakeBackend(options);
	const platform = createPlatform({ appName: "probe" }, backend);
	await platform.start();
	platform.createWindow({
		label: "main",
		url: "http://127.0.0.1:4123/?window=main",
	});
	const adapter = windowsWindowAdapter(() => platform);
	return {
		backend,
		adapter,
		commands: createWindowPlugin(adapter).commands as unknown as Commands,
	};
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

describe("a window that is not in its normal state", () => {
	/**
	 * `SW_RESTORE` also un-maximises: Win32 documents it as "restores the window to its original size
	 * and position", so `maximize()` then `unminimize()` lost the maximised size while answering ok.
	 * A window that is not minimised has nothing to un-minimise, so no ShowWindow is sent.
	 */
	test("unminimize leaves a maximised window alone", async () => {
		const { backend, commands } = await started({ maximized: true });
		expect(commands.unminimize?.({ label: "main" })).toMatchObject({
			ok: true,
		});
		expect(backend.calls.filter((call) => call.startsWith("show:"))).toEqual([]);
		expect(commands.isMaximized?.({ label: "main" })).toMatchObject({
			maximized: true,
		});
	});

	test("unminimize still restores a minimised window", async () => {
		const { backend, commands } = await started({ minimized: true });
		expect(commands.unminimize?.({ label: "main" })).toMatchObject({
			ok: true,
		});
		expect(backend.calls.filter((call) => call.startsWith("show:"))).toEqual(["show:2"]);
	});

	/**
	 * `GetWindowRect` answers the iconic off-screen rect for a minimised window (classically
	 * -32000,-32000), so the old read persisted that and the next `restore` reopened it nowhere.
	 */
	test("a minimised window reads its restore rect, never the iconic one", async () => {
		const { commands } = await started({ minimized: true });
		expect(commands.getSize?.({ label: "main" })).toMatchObject({
			width: 900,
			height: 640,
		});
		expect(commands.getPosition?.({ label: "main" })).toMatchObject({
			x: 40,
			y: 60,
		});
	});

	test("a maximised window reads its restore rect, never the monitor", async () => {
		const { commands } = await started({ maximized: true });
		expect(commands.getSize?.({ label: "main" })).toMatchObject({
			width: 900,
			height: 640,
		});
		expect(commands.getPosition?.({ label: "main" })).toMatchObject({
			x: 40,
			y: 60,
		});
	});

	/** A resize of a minimised window must start from the restore rect, or it moves it to -32000. */
	test("setSize on a minimised window writes the restore rect", async () => {
		const { backend, commands } = await started({ minimized: true });
		expect(commands.setSize?.({ label: "main", width: 800, height: 600 })).toMatchObject({
			ok: true,
		});
		expect(backend.calls).toContain("set_frame:40,60,800,600");
	});
});

describe("a frame that cannot be read", () => {
	/** `GetWindowRect` on a closed handle fails, and 0×0 is indistinguishable from a real 0×0. */
	test("is a named failure, not 0x0", async () => {
		const { adapter } = await started({ failFrameRead: true });
		expect(codeOf(() => adapter.getSize?.("main"))).toBe("handler-error");
		expect(codeOf(() => adapter.getPosition?.("main"))).toBe("handler-error");
	});

	test("and a write is refused rather than moving the window to nowhere", async () => {
		const { adapter } = await started({ failFrameRead: true });
		expect(codeOf(() => adapter.setSize?.("main", { width: 10, height: 10 }))).toBe(
			"handler-error",
		);
	});
});
