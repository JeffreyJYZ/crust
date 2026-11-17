/**
 * The real macOS adapter drops a closed window from `list()` while it stays
 * tracked, so existence cannot be decided by `list()` alone. These proofs use a
 * list that filters closed windows the way `WindowRegistry.labels()` does; the
 * shared fake lists them, which is exactly why the original defect hid.
 */

import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createWindowPlugin } from "./window.ts";
import { createWindowStatePlugin } from "./window-persist.ts";
import { fakeAdapter } from "./window-fake.ts";
import type { WindowNative } from "./window-types.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fake whose `list()` reports only open windows, like the darwin adapter. */
function filteringAdapter(): WindowNative & ReturnType<typeof fakeAdapter> {
	const base = fakeAdapter(["main"]);
	return {
		...base,
		list: () => [...base.windows.entries()].filter(([, w]) => w.open).map(([label]) => label),
	};
}

test("a closed-but-tracked window is not unknown: isOpen answers false and close stays idempotent", () => {
	const plugin = createWindowPlugin(filteringAdapter());

	expect(plugin.commands.close({ label: "main" })).toEqual({
		ok: true,
		label: "main",
		closed: true,
	});
	// The platform's list no longer includes it.
	expect(plugin.commands.list()).toEqual({ ok: true, labels: [] });
	expect(plugin.commands.isOpen({ label: "main" })).toEqual({
		ok: true,
		label: "main",
		open: false,
	});
	expect(plugin.commands.close({ label: "main" })).toEqual({
		ok: true,
		label: "main",
		closed: true,
	});
	// A label the adapter never held is still a typed failure.
	expect(plugin.commands.isOpen({ label: "ghost" })).toMatchObject({
		ok: false,
		code: "unknown-window",
		label: "ghost",
	});
});

test("window-state.save reaches a closed-but-tracked window too", async () => {
	const root = mkdtempSync(join(tmpdir(), "crust-window-closed-"));
	dirs.push(root);
	const adapter = filteringAdapter();
	createWindowPlugin(adapter).commands.close({ label: "main" });

	const state = createWindowStatePlugin({ native: adapter, root });
	expect(await state.commands.save({ label: "main" })).toEqual({
		ok: true,
		label: "main",
		frame: { x: 0, y: 0, width: 800, height: 600 },
	});
});
