/**
 * The explicit `window-state.restore` path, which is the only one a built app has, must apply the
 * same gone-monitor check the automatic dev path applies. A frame saved on an unplugged display
 * would otherwise put the window where nobody can see or drag it back.
 */
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createWindowStatePlugin } from "./window-persist.ts";
import { fakeWindow } from "./window-persist-fake.ts";

test("an explicit restore refuses a frame whose monitor is no longer present", async () => {
	const root = await mkdtemp(join(tmpdir(), "crust-window-state-monitor-"));
	try {
		const adapter = fakeWindow({ main: { x: 3000, y: 100, width: 900, height: 640 } });
		const plugin = createWindowStatePlugin({
			native: adapter,
			root,
			workAreas: () => [{ x: 0, y: 0, width: 1440, height: 900 }],
		});
		await plugin.commands.save({ label: "main" });
		adapter.windows.set("main", { x: 0, y: 0, width: 500, height: 400 });

		expect(await plugin.commands.restore({ label: "main" })).toEqual({
			ok: true,
			label: "main",
			restored: false,
		});
		expect(adapter.calls).toEqual([]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
