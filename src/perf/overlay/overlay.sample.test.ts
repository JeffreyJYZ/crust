import { describe, expect, test } from "bun:test";
import { fakePanel, fakeSampler, sample } from "./overlay.fixtures.ts";
import { mountOverlay } from "./overlay.ts";
import type { Panel } from "./panel.ts";

describe("overlay sample boundary", () => {
	test("a malformed sample degrades to page-only numbers", async () => {
		const scope = {
			crust: {
				invoke: async (_p: string, command: string) =>
					command === "sample"
						? {
								at: 1000,
								runtime: { eventLoopDelayP95: "fast" },
								events: { emitted: 1 },
								invoke: {},
							}
						: { ok: true },
			},
		};
		const panel = fakePanel();
		const overlay = mountOverlay({
			window: scope,
			dev: false,
			interval: () => 1,
			clearInterval: () => {},
			sampler: fakeSampler(),
			panel,
		});
		overlay.tick();
		await Bun.sleep(0);
		expect(overlay.runtimeMounted).toBe(false);
		expect(panel.updates[0]?.join("\n")).toContain("runtime half not mounted");
		overlay.destroy();
	});

	test("a throwing panel repaint is not an unhandled rejection", async () => {
		let rejections = 0;
		const onRejection = () => {
			rejections += 1;
		};
		process.on("unhandledRejection", onRejection);
		try {
			const throwing = {
				...fakePanel(),
				update() {
					throw new Error("repaint failed");
				},
			} as unknown as Panel;
			const scope = {
				crust: {
					invoke: async (_p: string, command: string) =>
						command === "sample" ? sample : { ok: true },
				},
			};
			const overlay = mountOverlay({
				window: scope,
				dev: false,
				interval: () => 1,
				clearInterval: () => {},
				sampler: fakeSampler(),
				panel: throwing,
			});
			overlay.tick();
			await Bun.sleep(20);
			expect(rejections).toBe(0);
			expect(overlay.runtimeMounted).toBe(true);
			overlay.destroy();
		} finally {
			process.off("unhandledRejection", onRejection);
		}
	});
});
