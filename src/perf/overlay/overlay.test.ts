import { describe, expect, test } from "bun:test";
import { fakePanel, fakeSampler, frame, sample } from "./overlay.fixtures.ts";
import { MARKER, mountOverlay, resolvePerf } from "./overlay.ts";
import type { FrameStats } from "./sampler.ts";

describe("overlay seam", () => {
	test("no runtime degrades to page-only numbers", () => {
		const panel = fakePanel();
		const overlay = mountOverlay({
			window: {},
			dev: false,
			interval: () => 1,
			clearInterval: () => {},
			sampler: fakeSampler(),
			panel,
		});
		expect(resolvePerf({})).toBeUndefined();
		expect(overlay.runtimeMounted).toBe(false);
		overlay.tick();
		expect(panel.updates[0]?.join("\n")).toContain("runtime half not mounted");
		expect(panel.updates[0]?.join("\n")).toContain(MARKER);
		expect(panel.updates[0]?.join("\n")).toContain("longtask n/a");
		overlay.destroy();
	});

	test("one frameReport and one sample per tick through the real invoke adapter", async () => {
		const calls: string[] = [];
		let reported: FrameStats | undefined;
		const scope = {
			crust: {
				invoke: async (plugin: string, command: string, args?: unknown) => {
					calls.push(`${plugin}.${command}`);
					if (command === "frameReport") reported = args as FrameStats;
					return command === "sample" ? sample : { ok: true };
				},
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
		expect(calls).toEqual(["perf.frameReport", "perf.sample"]);
		expect(reported?.framesDrawn).toBe(42);
		const text = panel.updates[0]?.join("\n") ?? "";
		expect(text).toContain("greet 7");
		expect(text).toContain("emitted 5 · delivered 4 · dropped 1");
		expect(overlay.runtimeMounted).toBe(true);
		overlay.destroy();
	});

	test("a refusal becomes the degraded line, not a thrown error", async () => {
		const scope = {
			crust: {
				invoke: async (_p: string, command: string) =>
					command === "sample"
						? { code: "not-implemented", requires: "perf plugin mounted" }
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

	test("no advancing frames reads as no frames", async () => {
		const panel = fakePanel();
		const still = { ...frame, framesDrawn: 0, fps: 0 } as FrameStats;
		const overlay = mountOverlay({
			window: {},
			dev: false,
			interval: () => 1,
			clearInterval: () => {},
			sampler: fakeSampler(still),
			panel,
		});
		overlay.tick();
		expect(panel.updates[0]?.join("\n")).toContain("no frames");
		expect(panel.updates[0]?.join("\n")).not.toContain("fps 0.0 ·");
		overlay.destroy();
	});

	test("dev chord toggles; a conflicting listener degrades to the API", () => {
		let handler: ((e: unknown) => void) | undefined;
		const doc = { addEventListener: (_t: string, fn: (e: unknown) => void) => (handler = fn) };
		const panel = fakePanel();
		const overlay = mountOverlay({
			window: { document: doc },
			dev: true,
			interval: () => 1,
			clearInterval: () => {},
			sampler: fakeSampler(),
			panel,
		});
		handler?.({ metaKey: true, shiftKey: true, key: "P" });
		expect(overlay.visible).toBe(true);
		handler?.({ metaKey: true, shiftKey: true, key: "p" });
		expect(overlay.visible).toBe(false);
		overlay.toggle();
		expect(overlay.visible).toBe(true);
		expect(() =>
			mountOverlay({
				window: {
					document: {
						addEventListener: () => {
							throw new Error("taken");
						},
					},
				},
				dev: true,
				panel: fakePanel(),
				sampler: fakeSampler(),
				interval: () => 1,
				clearInterval: () => {},
			}),
		).not.toThrow();
		overlay.destroy();
	});
});
