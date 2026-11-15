/**
 * `window-state`'s every-window commands against a temp directory and the shared fake adapter. The point of each test is the file and the labels in the answer: a `saveAll` that wrote once per window, or one that dropped a window it could not read, looks the same from the result alone.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createWindowStatePlugin, type WindowFrameNative } from "./window-persist.ts";
import { fakeWindow } from "./window-persist-fake.ts";

let root = "";

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "crust-window-state-all-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const stateFile = () => join(root, "window-state.json");
const written = async () => JSON.parse(await readFile(stateFile(), "utf8"));

test("saveAll writes every listed frame in one file, keeping the entries it did not see", async () => {
	const adapter = fakeWindow({
		main: { x: 120, y: 80, width: 900, height: 640 },
		prefs: { x: 400, y: 300, width: 420, height: 280 },
	});
	const plugin = createWindowStatePlugin({ native: adapter, root });
	await Bun.write(stateFile(), JSON.stringify({ gone: { x: 1, y: 2, width: 300, height: 200 } }));

	expect(await plugin.commands.saveAll()).toEqual({
		ok: true,
		saved: ["main", "prefs"],
		skipped: [],
	});
	expect(await written()).toEqual({
		gone: { x: 1, y: 2, width: 300, height: 200 },
		main: { x: 120, y: 80, width: 900, height: 640 },
		prefs: { x: 400, y: 300, width: 420, height: 280 },
	});
	// One write means one file and no leftover `.tmp`.
	expect(await readdir(root)).toEqual(["window-state.json"]);
	expect(adapter.calls).toEqual([]);
});

test("a window whose frame cannot be read is named in skipped and the rest still save", async () => {
	const adapter = fakeWindow(
		{
			main: { x: 5, y: 6, width: 800, height: 600 },
			ghost: { x: 0, y: 0, width: 1, height: 1 },
		},
		["ghost"],
	);
	const plugin = createWindowStatePlugin({ native: adapter, root });

	expect(await plugin.commands.saveAll()).toEqual({
		ok: true,
		saved: ["main"],
		skipped: ["ghost"],
	});
	expect(await written()).toEqual({ main: { x: 5, y: 6, width: 800, height: 600 } });
});

test("nothing readable saves nothing and writes no file at all", async () => {
	const adapter = fakeWindow({ ghost: { x: 0, y: 0, width: 1, height: 1 } }, ["ghost"]);
	const plugin = createWindowStatePlugin({ native: adapter, root });

	expect(await plugin.commands.saveAll()).toEqual({
		ok: true,
		saved: [],
		skipped: ["ghost"],
	});
	expect(await readdir(root)).toEqual([]);
});

test("restoreAll moves every saved window and names the ones with no entry", async () => {
	const adapter = fakeWindow({
		main: { x: 120, y: 80, width: 900, height: 640 },
		prefs: { x: 400, y: 300, width: 420, height: 280 },
		third: { x: 0, y: 0, width: 300, height: 200 },
	});
	const plugin = createWindowStatePlugin({ native: adapter, root });
	await plugin.commands.save({ label: "main" });
	await plugin.commands.save({ label: "prefs" });
	adapter.calls.length = 0;
	for (const label of ["main", "prefs", "third"]) {
		adapter.windows.set(label, { x: 0, y: 0, width: 200, height: 100 });
	}

	expect(await plugin.commands.restoreAll()).toEqual({
		ok: true,
		restored: ["main", "prefs"],
		missing: ["third"],
	});
	expect(adapter.windows.get("main")).toEqual({ x: 120, y: 80, width: 900, height: 640 });
	expect(adapter.windows.get("third")).toEqual({ x: 0, y: 0, width: 200, height: 100 });
	expect(adapter.calls).toEqual([
		"setSize:main:900x640",
		"setPosition:main:120,80",
		"setSize:prefs:420x280",
		"setPosition:prefs:400,300",
	]);
});

test("forgetAll clears the file, names what it dropped, and is idempotent", async () => {
	const adapter = fakeWindow({
		main: { x: 0, y: 0, width: 800, height: 600 },
		prefs: { x: 400, y: 300, width: 420, height: 280 },
	});
	const plugin = createWindowStatePlugin({ native: adapter, root });
	await plugin.commands.save({ label: "main" });
	await plugin.commands.save({ label: "prefs" });

	expect(await plugin.commands.forgetAll()).toEqual({ ok: true, removed: ["main", "prefs"] });
	expect(await readdir(root)).toEqual([]);
	expect(await plugin.commands.forgetAll()).toEqual({ ok: true, removed: [] });
	expect(await plugin.commands.restore({ label: "main" })).toEqual({
		ok: true,
		label: "main",
		restored: false,
	});
});

test("no adapter refuses every bulk command as not-implemented, and writes nothing", async () => {
	const plugin = createWindowStatePlugin({ root });
	for (const command of ["saveAll", "restoreAll", "forgetAll"] as const) {
		expect(await plugin.commands[command]()).toMatchObject({
			ok: false,
			code: "not-implemented",
			requires: "NSWindow",
		});
	}
	expect(await readdir(root)).toEqual([]);
});

test("an adapter holding only list is unknown-adapter rather than a TypeError", async () => {
	const partial = { list: () => ["main"] } as unknown as WindowFrameNative;
	const plugin = createWindowStatePlugin({ native: partial, root });

	expect(await plugin.commands.saveAll()).toMatchObject({
		ok: false,
		code: "unknown-adapter",
	});
	expect(await readdir(root)).toEqual([]);
});
