/**
 * `crust:autostart` against a temp home: the plist path, its contents, the atomic write leaving no temp file
 * behind, and a refusal that names the missing app. launchd itself is not under test — nothing here loads a
 * plist, so these proofs stop at "the file launchd would read is correct".
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type AutostartResult, createAutostartPlugin } from "@/plugins/autostart";

const ID = "land.jyz.example";

async function scratch(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "crust-autostart-"));
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

/** A minimal `.app` bundle, with or without the id launchd names the plist for. */
async function bundle(home: string, id?: string): Promise<string> {
	const app = join(home, "Example.app");
	await mkdir(join(app, "Contents"), { recursive: true });
	if (id !== undefined) {
		await writeFile(
			join(app, "Contents", "Info.plist"),
			`<plist><dict><key>CFBundleIdentifier</key>\n<string>${id}</string></dict></plist>`,
			"utf8",
		);
	}
	return app;
}

describe("autostart.enable", () => {
	test("writes a RunAtLoad LaunchAgent at Library/LaunchAgents/<id>.plist, atomically", async () => {
		const home = await scratch();
		try {
			const plugin = createAutostartPlugin({ home, bundleId: ID, platform: "darwin" });
			const app = await bundle(home);
			const result = await call(plugin, "enable", { appPath: app });

			const plist = join(home, "Library", "LaunchAgents", `${ID}.plist`);
			expect(result).toEqual({ ok: true, enabled: true, path: plist });
			const text = await readFile(plist, "utf8");
			expect(text).toContain("<key>Label</key>");
			expect(text).toContain(`<string>${ID}</string>`);
			expect(text).toContain("<key>RunAtLoad</key>");
			expect(text).toContain(`<string>${app}</string>`);
			// launchd execs argv[0]; a .app is a directory, so the bundle goes through /usr/bin/open.
			expect(text).toContain("<string>/usr/bin/open</string>");
			// The temp sibling is renamed away, so launchd only ever sees whole plists.
			expect(await readdir(join(home, "Library", "LaunchAgents"))).toEqual([`${ID}.plist`]);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	test("reads the bundle id from Info.plist when the adapter has none", async () => {
		const home = await scratch();
		try {
			const plugin = createAutostartPlugin({ home, platform: "darwin" });
			const app = await bundle(home, ID);
			const result = await call(plugin, "enable", { appPath: app });
			expect(result).toEqual({
				ok: true,
				enabled: true,
				path: join(home, "Library", "LaunchAgents", `${ID}.plist`),
			});
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	test("a missing app is not-found, naming the path", async () => {
		const home = await scratch();
		try {
			const plugin = createAutostartPlugin({ home, bundleId: ID, platform: "darwin" });
			const missing = join(home, "Nope.app");
			const result = await call(plugin, "enable", { appPath: missing });
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.code).toBe("not-found");
			expect(result.message).toContain(missing);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	test("no bundle id anywhere is bad-request, not a guessed name", async () => {
		const home = await scratch();
		try {
			const plugin = createAutostartPlugin({ home, platform: "darwin" });
			const app = await bundle(home);
			const result = await call(plugin, "enable", { appPath: app });
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.code).toBe("bad-request");
			expect(result.message).toContain(app);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});
});

describe("autostart.disable and isEnabled", () => {
	test("isEnabled follows the file, and disable removes it", async () => {
		const home = await scratch();
		try {
			const plugin = createAutostartPlugin({ home, bundleId: ID, platform: "darwin" });
			const app = await bundle(home);
			await call(plugin, "enable", { appPath: app });

			expect(await call(plugin, "isEnabled")).toMatchObject({ ok: true, enabled: true });
			expect(await call(plugin, "disable")).toMatchObject({ ok: true, enabled: false });
			expect(await call(plugin, "isEnabled")).toMatchObject({ ok: true, enabled: false });
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	test("the id enable learned is reused by disable and isEnabled", async () => {
		const home = await scratch();
		try {
			const plugin = createAutostartPlugin({ home, platform: "darwin" });
			const app = await bundle(home, ID);
			await call(plugin, "enable", { appPath: app });
			// No bundleId argument and none on the adapter: the id came from the plist read.
			expect(await call(plugin, "disable")).toMatchObject({ ok: true, enabled: false });
			expect(await call(plugin, "isEnabled")).toMatchObject({ ok: true, enabled: false });
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	test("isEnabled refuses a plist whose argv would fail execve, even though the file exists", async () => {
		const home = await scratch();
		try {
			const plugin = createAutostartPlugin({ home, bundleId: ID, platform: "darwin" });
			const app = await bundle(home);
			await call(plugin, "enable", { appPath: app });
			const plist = join(home, "Library", "LaunchAgents", `${ID}.plist`);
			// An older crust wrote the bundle directory as ProgramArguments[0]. The plist is still
			// there, but launchd would execve a directory; the old `exists` check said enabled: true.
			const wrong = (await readFile(plist, "utf8")).replace(
				"<string>/usr/bin/open</string>\n\t\t<string>" + app + "</string>",
				`<string>${app}</string>`,
			);
			await writeFile(plist, wrong, "utf8");
			expect(await call(plugin, "isEnabled")).toMatchObject({ ok: true, enabled: false });
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	test("a directory that is not a bundle is refused instead of being exec'd", async () => {
		const home = await scratch();
		try {
			const plugin = createAutostartPlugin({ home, bundleId: ID, platform: "darwin" });
			const dir = join(home, "tools");
			await mkdir(dir, { recursive: true });
			const result = await call(plugin, "enable", { appPath: dir });
			expect(result).toMatchObject({ ok: false, code: "bad-request" });
			expect(await call(plugin, "isEnabled")).toMatchObject({ ok: true, enabled: false });
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	test("a fresh plugin with no id refuses with bad-request", async () => {
		const home = await scratch();
		try {
			const plugin = createAutostartPlugin({ home, platform: "darwin" });
			const result = await call(plugin, "isEnabled");
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.code).toBe("bad-request");
			expect(result.message).toContain("bundleId");
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});
});
