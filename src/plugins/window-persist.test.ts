/**
 * `window-state`'s three commands against a temp directory and a fake frame adapter. Each test is about what the file holds and what crossed the seam: a save that wrote the wrong shape and a restore that applied nothing look identical from the result alone.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createWindowStatePlugin, type WindowFrameNative } from "./window-persist.ts";
import { fakeWindow } from "./window-persist-fake.ts";

let root = "";

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "crust-window-state-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const stateFile = () => join(root, "window-state.json");
const written = async () => JSON.parse(await readFile(stateFile(), "utf8"));

test("save writes each frame under its label and leaves no temporary file", async () => {
	const adapter = fakeWindow({
		main: { x: 120, y: 80, width: 900, height: 640 },
		prefs: { x: 400, y: 300, width: 420, height: 280 },
	});
	const plugin = createWindowStatePlugin({ native: adapter, root });

	expect(await plugin.commands.save({ label: "main" })).toEqual({
		ok: true,
		label: "main",
		frame: { x: 120, y: 80, width: 900, height: 640 },
	});
	await plugin.commands.save({ label: "prefs" });

	expect(await written()).toEqual({
		main: { x: 120, y: 80, width: 900, height: 640 },
		prefs: { x: 400, y: 300, width: 420, height: 280 },
	});
	// A stray `.tmp` would be the proof the rename never happened.
	expect(await readdir(root)).toEqual(["window-state.json"]);
	expect(adapter.calls).toEqual([]);
});

test("two saves fired together do not lose each other's frame", async () => {
	const adapter = fakeWindow({
		main: { x: 1, y: 2, width: 300, height: 200 },
		prefs: { x: 10, y: 20, width: 400, height: 300 },
	});
	const plugin = createWindowStatePlugin({ native: adapter, root });

	await Promise.all([
		plugin.commands.save({ label: "main" }),
		plugin.commands.save({ label: "prefs" }),
	]);

	expect(await written()).toEqual({
		main: { x: 1, y: 2, width: 300, height: 200 },
		prefs: { x: 10, y: 20, width: 400, height: 300 },
	});
});

test("a save in a second instance is not clobbered", async () => {
	const main = fakeWindow({ main: { x: 1, y: 2, width: 300, height: 200 } });
	const prefs = fakeWindow({ prefs: { x: 10, y: 20, width: 400, height: 300 } });
	const one = createWindowStatePlugin({ native: main, root });
	const two = createWindowStatePlugin({ native: prefs, root });

	await Promise.all([
		one.commands.save({ label: "main" }),
		two.commands.save({ label: "prefs" }),
	]);

	expect(await written()).toEqual({
		main: { x: 1, y: 2, width: 300, height: 200 },
		prefs: { x: 10, y: 20, width: 400, height: 300 },
	});
});

test("restore applies the saved frame and reports it", async () => {
	const adapter = fakeWindow({ main: { x: 120, y: 80, width: 900, height: 640 } });
	const plugin = createWindowStatePlugin({ native: adapter, root });
	await plugin.commands.save({ label: "main" });

	adapter.windows.set("main", { x: 0, y: 0, width: 500, height: 400 });
	expect(await plugin.commands.restore({ label: "main" })).toEqual({
		ok: true,
		label: "main",
		restored: true,
		frame: { x: 120, y: 80, width: 900, height: 640 },
	});
	expect(adapter.windows.get("main")).toEqual({ x: 120, y: 80, width: 900, height: 640 });
	expect(adapter.calls).toEqual(["setSize:main:900x640", "setPosition:main:120,80"]);
});

test("a missing or corrupt file restores nothing, and a save repairs it", async () => {
	const adapter = fakeWindow({ main: { x: 7, y: 8, width: 640, height: 480 } });
	const plugin = createWindowStatePlugin({ native: adapter, root });

	expect(await plugin.commands.restore({ label: "main" })).toEqual({
		ok: true,
		label: "main",
		restored: false,
	});
	expect(adapter.calls).toEqual([]);

	await Bun.write(stateFile(), '{"main": {"x": 1, "y": 2, "wid');
	expect(await plugin.commands.restore({ label: "main" })).toEqual({
		ok: true,
		label: "main",
		restored: false,
	});

	await plugin.commands.save({ label: "main" });
	expect(await written()).toEqual({ main: { x: 7, y: 8, width: 640, height: 480 } });
});

test("an entry of the wrong shape is skipped, and the good one still restores", async () => {
	await Bun.write(
		stateFile(),
		JSON.stringify({
			main: { x: "left", y: 0, width: 800, height: 600 },
			prefs: { x: 4, y: 5, width: 300, height: 200 },
		}),
	);
	const adapter = fakeWindow({
		main: { x: 0, y: 0, width: 800, height: 600 },
		prefs: { x: 0, y: 0, width: 300, height: 200 },
	});
	const plugin = createWindowStatePlugin({ native: adapter, root });

	expect(await plugin.commands.restore({ label: "main" })).toEqual({
		ok: true,
		label: "main",
		restored: false,
	});
	expect(await plugin.commands.restore({ label: "prefs" })).toEqual({
		ok: true,
		label: "prefs",
		restored: true,
		frame: { x: 4, y: 5, width: 300, height: 200 },
	});
});

test("forget removes one entry, keeps the rest, and is idempotent", async () => {
	const adapter = fakeWindow({
		main: { x: 0, y: 0, width: 800, height: 600 },
		prefs: { x: 400, y: 300, width: 420, height: 280 },
	});
	const plugin = createWindowStatePlugin({ native: adapter, root });
	await plugin.commands.save({ label: "main" });
	await plugin.commands.save({ label: "prefs" });

	expect(await plugin.commands.forget({ label: "prefs" })).toEqual({
		ok: true,
		label: "prefs",
		removed: true,
	});
	expect(await written()).toEqual({ main: { x: 0, y: 0, width: 800, height: 600 } });
	expect(await plugin.commands.forget({ label: "prefs" })).toEqual({
		ok: true,
		label: "prefs",
		removed: false,
	});
});

test("the three failures are typed values, and none of them writes a file", async () => {
	const adapter = fakeWindow({ main: { x: 0, y: 0, width: 800, height: 600 } });
	const plugin = createWindowStatePlugin({ native: adapter, root });
	expect(await plugin.commands.save({ label: "prefs" })).toEqual({
		ok: false,
		code: "unknown-window",
		message: 'crust: no window labelled "prefs"',
		label: "prefs",
	});

	expect(
		await createWindowStatePlugin({ root }).commands.restore({ label: "main" }),
	).toMatchObject({ ok: false, code: "not-implemented", requires: "NSWindow" });

	// The frame calls land in a sibling lane, so an adapter holding only `list`
	// is a real intermediate state rather than a hypothetical.
	const partial = { list: () => ["main"] } as unknown as WindowFrameNative;
	const half = createWindowStatePlugin({ native: partial, root });
	for (const command of ["save", "restore"] as const) {
		expect(await half.commands[command]({ label: "main" })).toMatchObject({
			ok: false,
			code: "unknown-adapter",
			label: "main",
		});
	}

	expect(await readdir(root)).toEqual([]);
});
