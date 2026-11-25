import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { record } from "./record.ts";
import { diffFiles } from "./diff.ts";
import type { PerfRecordFile } from "./types.ts";

const ENTRY = resolve(import.meta.dir, "../index.ts");
const PROBE = resolve(import.meta.dir, "../../../examples/perf-overlay/public");

const exists = async (path: string): Promise<boolean> =>
	stat(path).then(
		() => true,
		() => false,
	);

async function cli(args: string[]): Promise<{ code: number; out: string; err: string }> {
	const child = Bun.spawn({
		cmd: [process.execPath, "run", ENTRY, "perf", ...args],
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { code, out, err };
}

describe("perf record", () => {
	test("honest failure: a path that is not an app exits 2 with no file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "crust-perf-honest-"));
		const out = join(dir, "perf.json");
		expect(await record({ app: join(dir, "missing"), seconds: 1, out, format: "text" })).toBe(2);
		expect(await exists(out)).toBe(false);
		const run = await cli(["record", "--app", join(dir, "missing"), "--seconds", "1", "--out", out]);
		expect(run.code).toBe(2);
		expect(run.err).toContain("not an app");
		expect(await exists(out)).toBe(false);
	});

	test("round-trip: a real run, when it paints, diffs to zero; a stall is exit 2", async () => {
		if (process.platform !== "darwin") {
			// No WebKit here: the same command must still refuse instead of writing a fake sample.
			const dir = await mkdtemp(join(tmpdir(), "crust-perf-nonmac-"));
			const out = join(dir, "perf.json");
			expect(await record({ app: PROBE, seconds: 1, out, format: "text" })).toBe(2);
			expect(await exists(out)).toBe(false);
			return;
		}
		const dir = await mkdtemp(join(tmpdir(), "crust-perf-roundtrip-"));
		const out = join(dir, "perf.json");
		const code = await record({ app: PROBE, seconds: 1, out, format: "text" });
		if (code === 2) {
			expect(await exists(out)).toBe(false);
			return;
		}
		expect(code).toBe(0);
		const file = JSON.parse(await readFile(out, "utf8")) as PerfRecordFile;
		expect(file.meta.occlusionDetectionEnabled).toBe(false);
		expect(file.summary.frame.framesDrawn).toBeGreaterThan(0);
		expect(file.summary.frame.fps).toBeGreaterThan(0);
		expect(await diffFiles(out, out, 5)).toBe(0);
	});

	test("diff routes through the CLI entry point", async () => {
		const dir = await mkdtemp(join(tmpdir(), "crust-perf-cli-"));
		const before = join(dir, "a.json");
		const after = join(dir, "b.json");
		const sample = {
			version: 1,
			meta: {
				app: "fixture",
				seconds: 1,
				occlusionDetectionEnabled: false,
				occlusionState: 2,
				keepAwake: true,
				activation: "none",
				processesBefore: 1,
				processesAfter: 1,
				recordedAt: "2026-01-01T00:00:00.000Z",
			},
			summary: {
				frame: { framesDrawn: 60, fps: 60, p50: 12, p95: 20, worst: 40, longTasks: 0 },
				runtime: { eventLoopDelayP95: 1, heapUsed: 1000, heapTotal: 2000 },
				events: { emitted: 1, delivered: 1, dropped: 0, p95: 1 },
				invokeThroughput: 1,
				invokeP95: 1,
			},
			samples: [],
		};
		await writeFile(before, JSON.stringify(sample), "utf8");
		await writeFile(after, JSON.stringify(sample), "utf8");
		const run = await cli(["diff", before, after, "--tolerance", "5"]);
		expect(run.code).toBe(0);
		expect(run.out).toContain("frame.p95");
		expect(run.out).toContain("+0.0%");
	});
});
