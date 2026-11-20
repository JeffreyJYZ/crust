/**
 * The dev frame memory: the debounce (a drag is one write, not one per event), the visibility filter
 * on restore, and the last-frame save that survives a window closing. Every case uses a real temp
 * directory and the shared fake adapter, so the assertion is the file a restarted child would read.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFrameMemory, FRAME_DEBOUNCE_MS, setFrameMemory } from "./window-frame-memory.ts";
import { createWindowStatePlugin } from "./window-persist.ts";
import { fakeWindow } from "./window-persist-fake.ts";

const DISPLAY = { x: 0, y: 0, width: 1440, height: 900 };
const AREA = { x: 100, y: 100, width: 900, height: 600 };

let root = "";

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "crust-window-frame-memory-"));
});

afterEach(async () => {
	setFrameMemory(undefined);
	await rm(root, { recursive: true, force: true });
});

const file = () => join(root, "window-state.json");
const written = async () => JSON.parse(await readFile(file(), "utf8"));

describe("debounce", () => {
	test("samples inside the window coalesce into one write holding the last frame", async () => {
		const adapter = fakeWindow({
			main: { x: 0, y: 0, width: 800, height: 600 },
		});
		const memory = createFrameMemory({
			native: adapter,
			file: file(),
			workAreas: () => [DISPLAY],
			debounceMs: 40,
		});

		for (const width of [900, 1000, 1200]) {
			adapter.windows.set("main", { x: 0, y: 0, width, height: 700 });
			memory.sample();
		}
		// Nothing on disk before the frame settles: a write per event would already be here.
		expect(await readdir(root)).toEqual([]);

		await memory.flush();
		expect(await written()).toEqual({
			main: { x: 0, y: 0, width: 1200, height: 700 },
		});
		expect(await readdir(root)).toEqual(["window-state.json"]);
	});

	test("a sample whose frame did not move schedules no second write", async () => {
		const adapter = fakeWindow({
			main: { x: 0, y: 0, width: 800, height: 600 },
		});
		const memory = createFrameMemory({
			native: adapter,
			file: file(),
			workAreas: () => [DISPLAY],
		});
		memory.sample();
		await memory.flush();
		expect(await readdir(root)).toEqual(["window-state.json"]);

		// Nothing moved, so nothing is scheduled: clearing the file proves no write follows.
		await rm(file());
		memory.sample();
		await memory.flush();
		expect(await readdir(root)).toEqual([]);
	});
});

describe("restore", () => {
	test("drops a frame no display shows and keeps the one that fits", async () => {
		const adapter = fakeWindow({
			main: { x: 0, y: 0, width: 800, height: 600 },
		});
		await Bun.write(
			file(),
			JSON.stringify({
				main: { x: -3000, y: 0, width: 800, height: 600 },
				prefs: { x: 120, y: 80, width: 500, height: 400 },
			}),
		);
		const memory = createFrameMemory({
			native: adapter,
			file: file(),
			workAreas: () => [DISPLAY],
		});

		expect(await memory.restorable()).toEqual({
			prefs: { x: 120, y: 80, width: 500, height: 400 },
		});
	});

	test("an empty or corrupt file restores nothing and is not an error", async () => {
		const adapter = fakeWindow({
			main: { x: 0, y: 0, width: 800, height: 600 },
		});
		const memory = createFrameMemory({
			native: adapter,
			file: file(),
			workAreas: () => [DISPLAY],
		});
		expect(await memory.restorable()).toEqual({});

		await Bun.write(file(), "{ half a writ");
		expect(await memory.restorable()).toEqual({});
	});
});

test("place applies the size and then the position through the adapter", () => {
	const adapter = fakeWindow({
		main: { x: 0, y: 0, width: 800, height: 600 },
	});
	const memory = createFrameMemory({
		native: adapter,
		file: file(),
		workAreas: () => [DISPLAY],
	});
	memory.place("main", AREA);
	expect(adapter.windows.get("main")).toEqual(AREA);
	expect(adapter.calls).toEqual(["setSize:main:900x600", "setPosition:main:100,100"]);
});

test("a closed window's last frame is still saved", async () => {
	const adapter = fakeWindow({
		main: { x: 0, y: 0, width: 800, height: 600 },
	});
	const memory = createFrameMemory({
		native: adapter,
		file: file(),
		workAreas: () => [DISPLAY],
	});
	adapter.windows.set("main", { x: 40, y: 60, width: 1100, height: 720 });
	memory.sample();
	// `window.close` leaves no frame to read; the sampled one is what a restart must keep.
	adapter.windows.delete("main");
	await memory.saveAll();
	memory.stop();
	expect(await written()).toEqual({
		main: { x: 40, y: 60, width: 1100, height: 720 },
	});
});

test("a dev runner's directory arms the automatic half, and nothing else does", async () => {
	const adapter = fakeWindow({
		main: { x: 0, y: 0, width: 800, height: 600 },
	});
	const plugin = createWindowStatePlugin({
		native: adapter,
		root: join(root, "app-data"),
	});
	void plugin;
	expect(await readdir(join(root, "app-data")).catch(() => [])).toEqual([]);

	process.env.CRUST_WINDOW_STATE_DIR = join(root, "dev-run");
	try {
		createWindowStatePlugin({
			native: adapter,
			root: join(root, "app-data"),
			workAreas: () => [DISPLAY],
		});
		const memory = (await import("./window-frame-memory.ts")).frameMemory();
		expect(memory).toBeDefined();
		await memory?.flush();
		adapter.windows.set("main", { x: 1, y: 2, width: 900, height: 640 });
		await memory?.saveAll();
		expect(
			JSON.parse(await readFile(join(root, "dev-run", "window-state.json"), "utf8")),
		).toEqual({
			main: { x: 1, y: 2, width: 900, height: 640 },
		});
	} finally {
		delete process.env.CRUST_WINDOW_STATE_DIR;
	}
});

test("the default debounce is long enough for a drag", () => {
	expect(FRAME_DEBOUNCE_MS).toBeGreaterThan(100);
});
