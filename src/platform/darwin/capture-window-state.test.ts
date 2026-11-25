/**
 * The measurement table for `window.capture`: one launch per window state, through the probe at
 * `scripts/probe-capture-window-state.ts`, so a fix can be checked against numbers instead of
 * intuition. Each row says what the seam answered and whether the PNG it handed back is a real
 * picture — decoded, counted, not trusted.
 *
 * Nothing here is activated: the probe is an accessory app and its window is ordered front with
 * `orderFrontRegardless`, which never activates. The `onscreen` and `orderedout-plain` rows do put a
 * borderless window on the desktop for about two seconds, and that is the state being measured.
 *
 * The assertions are the invariant, not today's answer. A state may fail to produce a picture, but
 * it must then name a reason, and a success must be a picture: a 1x1 or fully transparent PNG is
 * "no picture" whatever the API said.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

/** Every state the brief names, plus the two levers the existing live proof applies, separated. */
export const STATES = [
	"onscreen",
	"offscreen",
	"offscreen-space",
	"offscreen-trick",
	"orderedout",
	"orderedout-plain",
	"hidden",
	"orphan",
] as const;

interface Row {
	state: string;
	facts?: Record<string, number | boolean>;
	ms?: number;
	error?: string;
	width?: number;
	height?: number;
	scale?: number;
	bytes?: number;
	measured?: {
		width: number;
		height: number;
		pixels: number;
		opaque: number;
		colours: number;
		differing: number;
	};
	unreachable?: string;
}

/** One launch: the probe prints a single JSON line, and a missing line is a failure of the probe. */
export function measure(state: string): Row {
	const root = join(import.meta.dir, "../../..");
	const child = Bun.spawnSync({
		cmd: ["bun", "run", "scripts/probe-capture-window-state.ts", state],
		cwd: root,
		stdout: "pipe",
		stderr: "pipe",
		timeout: 60_000,
	});
	const text = child.stdout.toString();
	const line = text
		.split("\n")
		.map((entry) => entry.trim())
		.filter((entry) => entry.startsWith("{"))
		.at(-1);
	if (line === undefined) {
		throw new Error(
			`capture probe ${state} printed no JSON (exit ${child.exitCode}): ` +
				child.stderr.toString().slice(-400),
		);
	}
	return JSON.parse(line) as Row;
}

/** The brief's rule: a picture is opaque, larger than a pixel, and not one flat colour. */
export function isPicture(row: Row): boolean {
	const shot = row.measured;
	return (
		shot !== undefined &&
		shot.width > 1 &&
		shot.height > 1 &&
		shot.opaque > 0 &&
		shot.differing > 0 &&
		shot.colours > 1
	);
}

function describeRow(row: Row): string {
	if (row.unreachable !== undefined) return `${row.state}: unreachable (${row.unreachable})`;
	if (row.measured === undefined) {
		return `${row.state}: ${row.ms} ms, error=${JSON.stringify(row.error)}, no picture`;
	}
	const shot = row.measured;
	return (
		`${row.state}: ${row.ms} ms, ${row.width}x${row.height}@${row.scale} ` +
		`${row.bytes} bytes, ${shot.opaque}/${shot.pixels} opaque, ${shot.colours} colours`
	);
}

describe("window.capture in every window state", () => {
	const darwin = process.platform === "darwin";

	test.skipIf(!darwin)(
		darwin
			? "measures each state and proves a picture or a named reason"
			: "skipped: window.capture needs WKWebView, which is macOS only",
		async () => {
			const rows: Row[] = [];
			for (const state of STATES) rows.push(measure(state));
			for (const row of rows) console.log(`capture ${describeRow(row)}`);

			const unreachable = rows.filter((row) => row.unreachable !== undefined);
			if (unreachable.length > 0) {
				console.log(
					`capture SKIP  no window server: ${unreachable.map((row) => row.state).join(", ")}`,
				);
				return;
			}

			for (const row of rows) {
				// A hang would be the worst outcome: a page awaiting the answer learns nothing.
				expect(row.ms ?? 0, `${row.state} answered inside the probe's budget`).toBeLessThan(
					20_000,
				);
				if (isPicture(row)) continue;
				// No picture is allowed; silence is not. The seam must name what went wrong.
				expect(
					row.error ?? "",
					`${row.state} names a reason when it hands back no picture`,
				).toMatch(/^crust: \S/);
			}

			// The baseline: an ordinary on-screen window must always answer a real picture.
			const onscreen = rows.find((row) => row.state === "onscreen");
			expect(onscreen, "the onscreen row ran").toBeDefined();
			if (onscreen) expect(isPicture(onscreen), "onscreen is a real picture").toBe(true);
		},
		180_000,
	);
});
