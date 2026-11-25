/**
 * The real picture the opt-in exists for, driven in a CHILD process: an accessory WKWebView in a
 * window at -4000,-4000, the geometry the live testing suite uses. The child never activates, orders
 * or changes a Space, so the human sees nothing; keeping AppKit in the child also stops this test
 * from marking the menu suite's "fresh process" state as already installed.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const live = process.platform === "darwin";

interface ProbeResult {
	calls?: string[];
	width?: number;
	height?: number;
	colours?: number;
	scale?: number;
	error?: string;
}

async function probe(): Promise<ProbeResult> {
	const root = join(import.meta.dir, "..", "..", "..");
	const child = Bun.spawn(["bun", "scripts/capture-occlusion-probe.ts"], {
		cwd: root,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	const line = out
		.trim()
		.split("\n")
		.find((part) => part.startsWith("{"));
	if (!line) throw new Error(`occlusion probe gave no JSON (exit ${code}): ${err.slice(0, 400)}`);
	return JSON.parse(line) as ProbeResult;
}

describe.skipIf(!live)("window.capture ignoreOcclusion on a real off-screen view", () => {
	test("a never-activated window at -4000,-4000 answers real pixels and restores the flag", async () => {
		const result = await probe();
		expect(result.error).toBeUndefined();
		// The window is 480x320 points; the bitmap is that times the display's own scale, which
		// is 2 on a Retina laptop and 1 on a non-Retina CI runner. Never hardcode either.
		expect(result.scale).toBeGreaterThanOrEqual(1);
		expect(result.width).toBe(480 * (result.scale ?? 0));
		expect(result.height).toBe(320 * (result.scale ?? 0));
		expect(result.colours).toBeGreaterThan(1);
		expect(result.calls).toEqual(["off", "take", "on"]);
	}, 30_000);
});
