/**
 * A window label is any non-empty string, so `"__proto__"` is legal. The state
 * map must have no inherited keys or that label is swallowed by the prototype
 * setter: the save reports a frame it never wrote and restore reads garbage.
 */

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createWindowStatePlugin } from "./window-persist.ts";
import { fakeWindow, type FakeFrame } from "./window-persist-fake.ts";
import { readState } from "./window-persist-store.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
	const root = mkdtempSync(join(tmpdir(), "crust-window-proto-"));
	dirs.push(root);
	const frames = Object.create(null) as Record<string, FakeFrame>;
	frames["__proto__"] = { x: 10, y: 20, width: 300, height: 200 };
	const adapter = fakeWindow(frames);
	return { root, adapter, plugin: createWindowStatePlugin({ native: adapter, root }) };
}

test("a __proto__ label is written as an own JSON key and restores its frame", async () => {
	const { root, adapter, plugin } = setup();
	const frame = { x: 10, y: 20, width: 300, height: 200 };

	expect(await plugin.commands.save({ label: "__proto__" })).toEqual({
		ok: true,
		label: "__proto__",
		frame,
	});
	const raw = JSON.parse(readFileSync(join(root, "window-state.json"), "utf8"));
	expect(Object.prototype.hasOwnProperty.call(raw, "__proto__")).toBe(true);
	expect(raw.__proto__).toEqual(frame);

	adapter.windows.get("__proto__")!.width = 1;
	expect(await plugin.commands.restore({ label: "__proto__" })).toEqual({
		ok: true,
		label: "__proto__",
		restored: true,
		frame,
	});
	expect(adapter.windows.get("__proto__")?.width).toBe(300);
});

test("readState returns a map with no inherited keys", async () => {
	const { root, plugin } = setup();
	await plugin.commands.save({ label: "__proto__" });
	const state = await readState(join(root, "window-state.json"));
	expect(Object.getPrototypeOf(state)).toBeNull();
	expect(state["__proto__"]).toEqual({ x: 10, y: 20, width: 300, height: 200 });
});
