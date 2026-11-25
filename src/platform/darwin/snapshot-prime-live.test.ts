/**
 * The real picture the harness-only opt-in exists for, driven in a CHILD process: a WKWebView in a
 * window at -4000,-4000 that has never been composited, idled 3000 ms so WebKit has stopped drawing.
 * The child never activates, orders online or changes a Space, so the human sees nothing; keeping
 * AppKit there also stops this test from marking the menu suite's fresh-process state as installed.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const live = process.platform === "darwin";

interface Row {
	mode?: string;
	ready?: number;
	before?: Record<string, number>;
	after?: Record<string, number>;
	ms?: number;
	width?: number;
	height?: number;
	opaque?: number;
	colours?: number;
	scale?: number;
	error?: string;
	secondCaptureComposited?: number;
	second?: string;
	result?: string;
	unreachable?: string;
}

/** One launch per mode, because a second capture supersedes the first and a state cannot be undone. */
function probe(mode: string): Row {
	const root = join(import.meta.dir, "..", "..", "..");
	const child = Bun.spawnSync({
		cmd: ["bun", "scripts/capture-prime-probe.ts", mode],
		cwd: root,
		stdout: "pipe",
		stderr: "pipe",
		timeout: 60_000,
	});
	const line = child.stdout
		.toString()
		.split("\n")
		.map((part) => part.trim())
		.filter((part) => part.startsWith("{"))
		.at(-1);
	if (line === undefined) {
		throw new Error(
			`prime probe ${mode} printed no JSON (exit ${child.exitCode}): ` +
				child.stderr.toString().slice(-400),
		);
	}
	return JSON.parse(line) as Row;
}

describe.skipIf(!live)("window.capture prime on a real never-composited view", () => {
	test("returns real pixels and restores every native fact", async () => {
		const row = probe("capture");
		expect(row.unreachable).toBeUndefined();
		expect(row.error).toBe("");
		expect(row.scale).toBeGreaterThanOrEqual(1);
		expect(row.width).toBe(480 * (row.scale ?? 0));
		expect(row.height).toBe(320 * (row.scale ?? 0));
		expect(row.opaque).toBeGreaterThan(0);
		expect(row.colours).toBeGreaterThan(1);
		expect(row.before?.composited).toBe(0);
		// Frame, alpha, visibility, Space membership, the composited bit and the holder count all
		// come back exactly where they started; the capture did not move the window at all.
		for (const key of ["x", "y", "w", "h", "alpha", "visible", "onActiveSpace", "composited", "holds"])
			expect(row.after?.[key], key).toBe(row.before?.[key]);
	}, 60_000);

	test("a second capture that did not ask for prime sees the bit cleared", async () => {
		const row = probe("capture");
		expect(row.secondCaptureComposited).toBe(0);
		expect(row.second).toContain("no composited picture");
	}, 60_000);

	test("the same bit makes an eval completion prompt, where the control stalls", async () => {
		const primed = probe("eval");
		const control = probe("eval-control");
		expect(primed.result).toBe("settled:ok");
		expect(primed.ms).toBeLessThan(1500);
		expect(control.result).toBe("stalled");
		expect(control.ms).toBeGreaterThanOrEqual(2500);
	}, 90_000);
});
