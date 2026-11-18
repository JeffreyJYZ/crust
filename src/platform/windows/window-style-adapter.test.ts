/**
 * The style members on Windows, driven through the plugin's own commands on a machine that is not
 * Windows: a real `WindowsPlatform` with the fake backend, so only user32 is fake.
 *
 * What each test proves is the **read-back**, which is the whole reason these members were refused in
 * the first pass: the answer comes from the style, the ex-style or the layered attribute the fake
 * holds, so a write that never landed reads as the old value instead of as the request.
 * Fullscreen keeps a saved frame, so it is `window-fullscreen-adapter.test.ts`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import type { WindowNative } from "@/plugins/window";
import { createWindowPlugin } from "@/plugins/window.ts";
import { setActiveWindowsPlatform } from "./active-platform.ts";
import { fakeBackend } from "./fake-backend.ts";
import { createPlatform } from "./platform.ts";
import { windowsWindowAdapter } from "./window-adapter.ts";

type Commands = Record<string, (args: unknown) => unknown>;

async function started(options: Parameters<typeof fakeBackend>[0] = {}): Promise<{
	backend: ReturnType<typeof fakeBackend>;
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

afterEach(() => {
	setActiveWindowsPlatform(undefined);
});

describe("always-on-top", () => {
	test("is read back from WS_EX_TOPMOST, not remembered", async () => {
		const { backend, commands } = await started();
		expect(commands.setAlwaysOnTop?.({ label: "main", value: true })).toMatchObject({
			ok: true,
		});
		expect(commands.isAlwaysOnTop?.({ label: "main" })).toMatchObject({ alwaysOnTop: true });
		expect(commands.setAlwaysOnTop?.({ label: "main", value: false })).toMatchObject({
			ok: true,
		});
		expect(commands.isAlwaysOnTop?.({ label: "main" })).toMatchObject({ alwaysOnTop: false });
		expect(backend.calls.filter((call) => call.startsWith("topmost:"))).toEqual([
			"topmost:1",
			"topmost:0",
		]);
	});

	test("a refused SetWindowPos is a named failure", async () => {
		const { commands } = await started({ failTopmost: true });
		expect(commands.setAlwaysOnTop?.({ label: "main", value: true })).toMatchObject({
			ok: false,
			code: "handler-error",
		});
	});
});

describe("decorations", () => {
	test("clearing and restoring the frame bits reads back from GWL_STYLE", async () => {
		const { commands } = await started();
		expect(commands.isDecorated?.({ label: "main" })).toMatchObject({ decorations: true });
		expect(commands.setDecorations?.({ label: "main", value: false })).toMatchObject({
			ok: true,
		});
		expect(commands.isDecorated?.({ label: "main" })).toMatchObject({ decorations: false });
		expect(commands.setDecorations?.({ label: "main", value: true })).toMatchObject({
			ok: true,
		});
		expect(commands.isDecorated?.({ label: "main" })).toMatchObject({ decorations: true });
	});

	/**
	 * `GWL_STYLE` and `GWL_EXSTYLE` are separate fields, so the style write cannot clear the layered
	 * bit — the case the brief asked to check rather than assume.
	 */
	test("a decoration toggle does not drop the layered alpha", async () => {
		const { commands } = await started();
		commands.setOpacity?.({ label: "main", value: 0.5 });
		commands.setDecorations?.({ label: "main", value: false });
		const applied = commands.opacity?.({ label: "main" }) as { opacity: number };
		expect(applied.opacity).toBeCloseTo(128 / 255, 10);
	});

	test("a refused style write is a named failure", async () => {
		const { commands } = await started({ failStyle: true });
		expect(commands.setDecorations?.({ label: "main", value: false })).toMatchObject({
			ok: false,
			code: "handler-error",
		});
	});
});

describe("opacity", () => {
	test("round-trips as the 8-bit alpha Windows holds", async () => {
		const { commands } = await started();
		expect(commands.setOpacity?.({ label: "main", value: 0.25 })).toMatchObject({ ok: true });
		const applied = commands.opacity?.({ label: "main" }) as { opacity: number };
		// 0.25 * 255 is 63.75, applied as 64: the number asked for is not the number stored, and the
		// read-back reports the stored one.
		expect(applied.opacity).toBeCloseTo(64 / 255, 10);
	});

	test("an untouched window is fully opaque", async () => {
		const { commands } = await started();
		expect(commands.opacity?.({ label: "main" })).toMatchObject({ opacity: 1 });
	});

	test("a refused layered call is a named failure", async () => {
		const { commands } = await started({ failAlpha: true });
		expect(commands.setOpacity?.({ label: "main", value: 0.5 })).toMatchObject({
			ok: false,
			code: "handler-error",
		});
	});
});
