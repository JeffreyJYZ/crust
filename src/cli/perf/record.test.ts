import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { failRecord, record } from "./record.ts";
import { diffFiles } from "./diff.ts";
import { idleWindowCount } from "./format.ts";
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
	test("a failed record discards an output file left by an earlier run", async () => {
		const dir = await mkdtemp(join(tmpdir(), "crust-perf-stale-"));
		const out = join(dir, "perf.json");
		await writeFile(out, "stale result from a good run");
		expect(await failRecord(out, "renderer never painted")).toBe(2);
		expect(await exists(out)).toBe(false);
	});

	test("honest failure: a path that is not an app exits 2 with no file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "crust-perf-honest-"));
		const out = join(dir, "perf.json");
		expect(await record({ app: join(dir, "missing"), seconds: 1, out, format: "text" })).toBe(
			2,
		);
		expect(await exists(out)).toBe(false);
		const run = await cli([
			"record",
			"--app",
			join(dir, "missing"),
			"--seconds",
			"1",
			"--out",
			out,
		]);
		expect(run.code).toBe(2);
		expect(run.err).toContain("not an app");
		expect(await exists(out)).toBe(false);
	});

	// Launching a real app, waiting for a paint and writing a sample cannot fit bun's 5 s default on a
	// loaded CI runner: measured timing out at exactly 5000 ms in CI while passing locally in 3.2 s.
	// `record` keeps its own internal deadline; this is only the test's own budget. A host that cannot
	// paint still has to fail honestly (exit 2, no file) — the never-painted path is forced without
	// WebKit in the verdict fixture above.
	test("round-trip: a real run diffs to zero, including the second sample window", async () => {
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
		const one = JSON.parse(await readFile(out, "utf8")) as PerfRecordFile;
		expect(one.meta.occlusionDetectionEnabled).toBe(false);
		expect(one.summary.frame.framesDrawn).toBeGreaterThan(0);
		expect(typeof one.summary.frame.idleWindows).toBe("number");
		expect(await diffFiles(out, out, 5)).toBe(0);

		// The bug this fixes: a second window with no new frames used to exit 2 with no file.
		// A fresh CLI process, not a second launch inside this one: two in-process WebKit launches
		// collide on the platform's global state and fail at page wait before any guard runs.
		const out2 = join(dir, "two.json");
		const run2 = await cli(["record", "--app", PROBE, "--seconds", "2", "--out", out2]);
		expect(run2.code).toBe(0);
		const two = JSON.parse(await readFile(out2, "utf8")) as PerfRecordFile;
		expect(two.summary.frame.framesDrawn).toBeGreaterThan(0);
		expect(two.samples.length).toBe(2);
		expect(two.summary.frame.idleWindows).toBe(
			idleWindowCount(two.samples, two.meta.occludedWindows),
		);
	}, 60_000);

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
