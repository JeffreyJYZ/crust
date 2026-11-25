import { describe, expect, test } from "bun:test";
import { mountOverlay } from "./overlay.ts";
import type { Panel } from "./panel.ts";
import type { Sampler } from "./sampler.ts";

describe("overlay hotkey lifetime", () => {
	test("destroy removes the keydown listener it installed", () => {
		const added: Array<(e: unknown) => void> = [];
		const removed: Array<(e: unknown) => void> = [];
		const doc = {
			addEventListener: (_t: string, fn: (e: unknown) => void) => {
				added.push(fn);
			},
			removeEventListener: (_t: string, fn: (e: unknown) => void) => {
				removed.push(fn);
			},
		};
		const overlay = mountOverlay({
			window: { document: doc },
			dev: true,
			interval: () => 1,
			clearInterval: () => {},
			sampler: {
				frame: () => null,
				stop() {},
			} as unknown as Sampler,
			panel: {
				show() {},
				hide() {},
				update() {},
				destroy() {},
			} as unknown as Panel,
		});
		expect(added.length).toBe(1);
		overlay.destroy();
		expect(removed).toEqual(added);
	});
});
