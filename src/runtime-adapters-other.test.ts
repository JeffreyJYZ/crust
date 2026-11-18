/**
 * The three core namespaces through the registry, which is how `MATRIX.md` measured them: build the
 * plugin set the OS would get and call the command a page would call.
 *
 * The Windows half runs against a fake backend, so the answers are the adapter's own and no Win32
 * symbol is touched. The Linux half runs for real on this machine and proves the thing that matters
 * off Linux: the refusal now names GTK and `libgtk-3.so.0`, not `NSPasteboard`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { setActiveLinuxTray } from "@/platform/linux/tray-tick";
import { setActiveWindowsPlatform } from "@/platform/windows/active-platform";
import { fakeBackend } from "@/platform/windows/fake-backend";
import { createPlatform } from "@/platform/windows/platform-factory";
import { setActiveWindowsTray } from "@/platform/windows/tray-tick";
import type { PluginDefinition } from "@/plugins/define";
import { replacesCoreNamespace } from "@/runtime-adapters-other.ts";
import { nativePlugins } from "@/runtime-plugins.ts";

type Commands = Record<string, (args: unknown) => unknown>;

/** The commands of one registered plugin, by name. */
async function commandsOf(os: string, name: string): Promise<Commands> {
	const plugins = await nativePlugins([], undefined, { app: "land.jyz.core" }, os);
	const plugin = plugins.find((entry: PluginDefinition) => entry.name === name);
	if (plugin === undefined) throw new Error(`${name} is not registered for ${os}`);
	return plugin.commands as unknown as Commands;
}

/** A started Windows platform holding the answers the fake backend was given. */
async function windowsPlatform(clipboard: string): Promise<void> {
	const platform = createPlatform(
		{ appName: "probe" },
		fakeBackend({
			clipboard,
			osVersion: [10, 0, 22631],
			osLocale: "en-GB",
			osUptime: 99,
		}),
	);
	await platform.start();
}

afterEach(() => {
	setActiveWindowsPlatform(undefined);
	setActiveWindowsTray(undefined);
	setActiveLinuxTray(undefined);
});

describe("win32: the three namespaces answer from the Win32 shim", () => {
	test("clipboard.read and write reach OpenClipboard and SetClipboardData", async () => {
		await windowsPlatform("copied on windows");
		const clipboard = await commandsOf("win32", "clipboard");
		expect(clipboard.read?.({})).toEqual({ ok: true, text: "copied on windows" });
		expect(clipboard.write?.({ text: "hello" })).toEqual({ ok: true, written: true });
	});

	test("opener.openUrl reaches ShellExecuteW", async () => {
		await windowsPlatform("");
		const opener = await commandsOf("win32", "opener");
		expect(await opener.openUrl?.({ url: "https://crust.dev" })).toEqual({
			ok: true,
			url: "https://crust.dev",
		});
	});

	test("os.info reports the RtlGetVersion build and the user's locale", async () => {
		await windowsPlatform("");
		const os = await commandsOf("win32", "os");
		expect(await os.info?.({})).toMatchObject({
			ok: true,
			version: "10.0.22631",
			appVersion: null,
			uptime: 99,
		});
		expect(await os.locale?.({})).toEqual({ ok: true, locale: "en-GB" });
	});

	test("a win32 run with no platform names Win32, never AppKit", async () => {
		const clipboard = await commandsOf("win32", "clipboard");
		const answer = clipboard.read?.({}) as { ok: false; code: string; message: string };
		expect(answer.ok).toBe(false);
		expect(answer.code).toBe("handler-error");
		expect(answer.message).toContain("no Windows platform is attached");
		expect(answer.message).not.toContain("NSPasteboard");
	});
});

describe("linux: the three namespaces answer from GTK", () => {
	test("clipboard refuses with GTK's own call, never NSPasteboard", async () => {
		const clipboard = await commandsOf("linux", "clipboard");
		const answer = clipboard.read?.({}) as { ok: false; code: string; message: string };
		expect(answer.ok).toBe(false);
		expect(answer.code).toBe("handler-error");
		expect(answer.message).toContain("libgtk-3.so.0");
		expect(answer.message).not.toContain("NSPasteboard");
	});

	test("opener.revealItem refuses with the reason no Linux desktop can select an item", async () => {
		const opener = await commandsOf("linux", "opener");
		const answer = (await opener.revealItem?.({ path: "/tmp" })) as {
			ok: false;
			code: string;
			message: string;
		};
		expect(answer.ok).toBe(false);
		expect(answer.message).toContain("no Linux desktop has a standard reveal-a-selection call");
		expect(answer.message).not.toContain("NSWorkspace");
	});

	test("os.info answers a real version off /etc/os-release or the kernel", async () => {
		const os = await commandsOf("linux", "os");
		const answer = (await os.info?.({})) as { ok: true; version: string; appVersion: null };
		expect(answer.ok).toBe(true);
		expect(answer.version.length).toBeGreaterThan(0);
		expect(answer.appVersion).toBeNull();
	});
});

describe("which bare plugins are dropped", () => {
	test("the five names are replaced on both OSes and nowhere else", () => {
		for (const name of ["clipboard", "opener", "os", "notification", "tray"]) {
			expect(replacesCoreNamespace(name, "win32")).toBe(true);
			expect(replacesCoreNamespace(name, "linux")).toBe(true);
			expect(replacesCoreNamespace(name, "darwin")).toBe(false);
		}
		expect(replacesCoreNamespace("window", "linux")).toBe(false);
	});

	test("no namespace is registered twice on either OS", async () => {
		await windowsPlatform("");
		for (const os of ["win32", "linux"]) {
			const plugins = await nativePlugins([], undefined, { app: "land.jyz.core" }, os);
			const names = plugins.map((plugin) => plugin.name);
			expect(new Set(names).size).toBe(names.length);
			expect(names).toContain("clipboard");
			expect(names).toContain("opener");
			expect(names).toContain("os");
		}
	});
});
