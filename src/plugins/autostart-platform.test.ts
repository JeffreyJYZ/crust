/**
 * `crust:autostart` on the two platforms that are not macOS, proved on this macOS machine by
 * injecting `platform`. The defect this file exists for: `enable` answered `{ ok: true, enabled:
 * true }` on Windows and Linux while writing a LaunchAgent plist neither OS reads, so an app
 * believed it would start at login and it would not. Windows is refused by name; Linux gets its own
 * XDG entry, read back rather than assumed.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type AutostartResult, createAutostartPlugin } from "@/plugins/autostart";

const ID = "land.jyz.example";

async function scratch(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "crust-autostart-os-"));
}

async function call(
	plugin: ReturnType<typeof createAutostartPlugin>,
	name: string,
	args?: unknown,
): Promise<AutostartResult> {
	const table = plugin.commands as Record<string, (input?: unknown) => Promise<AutostartResult>>;
	const handler = table[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return await handler(args);
}

/** An executable to point `Exec` at; a plain file is enough, `enable` only checks it exists. */
async function executable(home: string, name = "app"): Promise<string> {
	const path = join(home, "bin", name);
	await mkdir(join(home, "bin"), { recursive: true });
	await writeFile(path, "#!/bin/sh\n", { mode: 0o755 });
	return path;
}

async function present(path: string): Promise<boolean> {
	return await stat(path).then(
		() => true,
		() => false,
	);
}

describe("autostart on Windows", () => {
	test("enable refuses by name instead of answering ok, and writes no macOS tree", async () => {
		const home = await scratch();
		try {
			const plugin = createAutostartPlugin({ home, bundleId: ID, platform: "win32" });
			const app = await executable(home);
			const result = await call(plugin, "enable", { appPath: app });

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.code).toBe("unsupported-platform");
			// The message names the mechanism Windows would need, so a caller learns why.
			expect(result.message).toContain("CurrentVersion\\Run");
			// The regression: nothing shaped like a LaunchAgent may appear on this platform.
			expect(await present(join(home, "Library"))).toBe(false);
			expect(await present(join(home, ".config"))).toBe(false);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	test("disable and isEnabled refuse too, without needing a bundle id", async () => {
		const home = await scratch();
		try {
			const plugin = createAutostartPlugin({ home, platform: "win32" });
			for (const command of ["disable", "isEnabled"]) {
				const result = await call(plugin, command);
				expect(result).toMatchObject({ ok: false, code: "unsupported-platform" });
			}
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	test("a platform with no mechanism at all is refused the same way", async () => {
		const home = await scratch();
		try {
			const plugin = createAutostartPlugin({ home, bundleId: ID, platform: "freebsd" });
			const result = await call(plugin, "isEnabled");
			expect(result).toMatchObject({ ok: false, code: "unsupported-platform" });
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});
});

describe("autostart on Linux", () => {
	test("enable writes an XDG entry, not a plist, and answers the path it wrote", async () => {
		const home = await scratch();
		try {
			const plugin = createAutostartPlugin({ home, bundleId: ID, platform: "linux" });
			const app = await executable(home);
			const entry = join(home, ".config", "autostart", `${ID}.desktop`);
			const result = await call(plugin, "enable", { appPath: app });

			expect(result).toEqual({ ok: true, enabled: true, path: entry });
			expect(await present(join(home, "Library"))).toBe(false);
			const text = await readFile(entry, "utf8");
			expect(text).toContain("[Desktop Entry]");
			expect(text).toContain("Type=Application");
			expect(text).toContain("X-GNOME-Autostart-enabled=true");
			expect(text).toContain(`Exec=${app}`);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	test("a path holding a space is quoted, and a $ is escaped twice, so no expansion runs", async () => {
		const home = await scratch();
		try {
			const plugin = createAutostartPlugin({ home, bundleId: ID, platform: "linux" });
			const app = await executable(home, "my app$x");
			await call(plugin, "enable", { appPath: app });
			const text = await readFile(
				join(home, ".config", "autostart", `${ID}.desktop`),
				"utf8",
			);
			// `Exec` quoting escapes the `$`, then the key-file string escapes that backslash: `\\$`.
			expect(text).toContain(`Exec="${app.replaceAll("$", "\\\\$")}"`);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	test("isEnabled reads the entry back, so Hidden=true and a removed file both answer false", async () => {
		const home = await scratch();
		try {
			const plugin = createAutostartPlugin({ home, bundleId: ID, platform: "linux" });
			const app = await executable(home);
			const entry = join(home, ".config", "autostart", `${ID}.desktop`);
			await call(plugin, "enable", { appPath: app });
			expect(await call(plugin, "isEnabled")).toMatchObject({ ok: true, enabled: true });

			// The file still exists; the spec's `Hidden` key is what stops it starting.
			const text = await readFile(entry, "utf8");
			await writeFile(entry, `${text}Hidden=true\n`, "utf8");
			expect(await call(plugin, "isEnabled")).toMatchObject({ ok: true, enabled: false });

			expect(await call(plugin, "disable")).toMatchObject({ ok: true, enabled: false });
			expect(await present(entry)).toBe(false);
			expect(await call(plugin, "isEnabled")).toMatchObject({ ok: true, enabled: false });
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	test("configHome is where XDG_CONFIG_HOME would point", async () => {
		const home = await scratch();
		try {
			const configHome = join(home, "xdg");
			const plugin = createAutostartPlugin({
				home,
				bundleId: ID,
				platform: "linux",
				configHome,
			});
			const app = await executable(home);
			const result = await call(plugin, "enable", { appPath: app });
			expect(result).toMatchObject({ path: join(configHome, "autostart", `${ID}.desktop`) });
			expect(await present(join(home, ".config"))).toBe(false);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	test("an id with a path separator is refused, because it names a file", async () => {
		const home = await scratch();
		try {
			const plugin = createAutostartPlugin({ home, platform: "linux" });
			const app = await executable(home);
			const result = await call(plugin, "enable", {
				appPath: app,
				bundleId: "../../escape",
			});
			expect(result).toMatchObject({ ok: false, code: "bad-request" });
			expect(await present(join(home, "escape.desktop"))).toBe(false);
			expect(await present(join(home, ".config"))).toBe(false);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});
});
