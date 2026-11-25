/**
 * The `perf` namespace is additive and opt-in: before mounting, all four commands refuse with a
 * typed `requires`; after mounting they answer through the one collector. No overlay or native code.
 */

import { describe, expect, test } from "bun:test";
import { Collector } from "@/perf/collector";
import { createPerfCommands, createPerfPlugin, PERF_REQUIRES } from "./perf.ts";
import { isNotImplemented } from "./define";

type Commands = ReturnType<typeof createPerfCommands>;

function call(commands: Commands, name: string, args?: unknown): unknown {
	const table = commands as unknown as Record<string, (input?: unknown) => unknown>;
	const handler = table[name];
	if (handler === undefined) throw new Error(`no command ${name}`);
	return handler(args);
}

describe("perf commands", () => {
	test("unmounted refuses sample, frameReport, overlay, sinks and reset with a requires string", () => {
		const commands = createPerfCommands(new Collector(), () => 1000);
		for (const name of ["sample", "frameReport", "overlay", "sinks", "reset"]) {
			const answer = call(commands, name, name === "overlay" ? { enabled: true } : undefined);
			expect(isNotImplemented(answer)).toBe(true);
			if (isNotImplemented(answer)) {
				expect(answer.requires).toBe(PERF_REQUIRES);
				expect(answer.code).toBe("not-implemented");
			}
		}
	});

	test("mounted plugin answers sample, sinks, overlay and reset", () => {
		const collector = new Collector();
		const at = (ms: number) => () => collector.startedAt + ms;
		const plugin = createPerfPlugin(collector, at(1000));
		expect(plugin.name).toBe("perf");
		const commands = createPerfCommands(collector, at(1000));
		try {
			expect(call(commands, "sinks", { overlay: true })).toEqual({
				overlay: true,
				file: false,
				stdout: false,
			});
			expect(collector.enabled).toBe(true);
			expect(call(commands, "overlay", { enabled: false })).toEqual({ enabled: false });
			expect(collector.enabled).toBe(false);
			const sample = call(commands, "sample") as {
				at: number;
				invoke: object;
				frame: unknown;
			};
			expect(sample.at).toBe(1000);
			expect(sample.invoke).toEqual({});
			expect(sample.frame).toBeNull();
			const frame = { framesDrawn: 56, fps: 56, p50: 17, p95: 26, worst: 40, longTasks: 0 };
			expect(call(commands, "frameReport", frame)).toEqual({ ok: true });
			expect((call(commands, "sample") as { frame: unknown }).frame).toEqual(frame);
			expect(call(commands, "reset")).toEqual({ ok: true });
		} finally {
			collector.setSinks({ overlay: false, file: false, stdout: false });
		}
	});

	test("the default sample clock matches the collector's own clock", () => {
		const collector = new Collector();
		collector.mount();
		const commands = createPerfCommands(collector);
		const answer = call(commands, "sample") as { at: number };
		expect(answer.at).toBeGreaterThanOrEqual(0);
		expect(answer.at).toBeLessThan(1000);
	});
});
