/**
 * Shared fakes for the preview plugin tests: a panel-shaped surface, an offline scope check and a
 * real `fs.scope` over a throwaway directory. Kept in one place so the plugin tests stay under the
 * 200-line cap without trimming the reason any assertion exists.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFsScope } from "@/plugins/fs-scope";
import type { PreviewSurface } from "@/plugins/preview-surface";

export const OFFLINE = { check: async () => {} };

const roots: string[] = [];
export async function cleanup(): Promise<void> {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}

/** A surface that answers like a panel: shown until hidden, with its own visible read. */
export function fakeSurface(): PreviewSurface & { path?: string; window?: string } {
	const state = {
		visible: false,
		path: undefined as string | undefined,
		window: undefined as string | undefined,
	};
	return {
		name: "fake",
		get path() {
			return state.path;
		},
		get window() {
			return state.window;
		},
		show(request) {
			state.path = request.path;
			state.window = request.window;
			state.visible = true;
			return { ok: true, window: 7 };
		},
		hide() {
			state.visible = false;
			return { ok: true };
		},
		visible: () => state.visible,
	};
}

/** A real `fs.scope` over one directory, in the system temp dir so no app data is touched. */
export async function scopeWith(): Promise<{
	inside: string;
	outside: string;
	scope: ReturnType<typeof createFsScope>;
}> {
	const root = await mkdtemp(join(tmpdir(), "crust-preview-scope-"));
	roots.push(root);
	const inside = join(root, "inside");
	const outside = join(root, "outside");
	await mkdir(inside, { recursive: true });
	await mkdir(outside, { recursive: true });
	await writeFile(join(inside, "report.txt"), "inside");
	await writeFile(join(outside, "secret.txt"), "outside");
	return { inside, outside, scope: createFsScope({ allow: [inside], root }) };
}
