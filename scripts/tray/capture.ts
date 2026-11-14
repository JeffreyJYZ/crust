/**
 * Taking a capture: one `screencapture` call per region, decoded immediately.
 *
 * Nothing here moves the pointer or sends input. A screenshot is a read.
 */
import { join } from "node:path";
import { type Bitmap, decodeBmp } from "./bitmap.ts";
import { DIR } from "./constants.ts";

export interface Capture {
	readonly name: string;
	readonly bitmap: Bitmap | null;
	/** Empty when the capture succeeded; the exact stderr otherwise. */
	readonly error: string;
}

export interface Screen {
	x: number;
	y: number;
	w: number;
	h: number;
}

let screen: Screen = { x: 0, y: 0, w: 0, h: 0 };

/** The display rectangle this run measured, so every region is clamped to it. */
export function setScreen(bounds: Screen): void {
	screen = bounds;
}

/** The same rectangle, for the entry's point arithmetic. */
export function screenSize(): Screen {
	return screen;
}

export function capture(name: string, region: string | null, extra: string[] = []): Capture {
	const path = join(DIR, `${name}.bmp`);
	const args = ["screencapture", "-x", "-t", "bmp"];
	if (region !== null) args.push("-R", region);
	const proc = Bun.spawnSync({ cmd: [...args, ...extra, path], stdout: "pipe", stderr: "pipe" });
	const stderr = proc.stderr.toString().trim();
	if (proc.exitCode !== 0) {
		return { name, bitmap: null, error: `exit ${proc.exitCode}: ${stderr || "(no stderr)"}` };
	}
	try {
		return { name, bitmap: decodeBmp(path), error: "" };
	} catch (error) {
		return {
			name,
			bitmap: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/** The display rectangle in points, which is what `-R` takes. */
export function desktopBounds(): Screen {
	const proc = Bun.spawnSync({
		cmd: ["osascript", "-e", 'tell application "Finder" to get bounds of window of desktop'],
		stdout: "pipe",
		stderr: "pipe",
	});
	const text = proc.stdout.toString().trim();
	const parts = text.split(",").map((piece) => Number(piece.trim()));
	const [right, bottom] = [parts[2] ?? Number.NaN, parts[3] ?? Number.NaN];
	if (proc.exitCode !== 0 || parts.length !== 4 || !Number.isFinite(right)) {
		throw new Error(`desktop bounds unreadable: ${text || proc.stderr.toString().trim()}`);
	}
	return { x: 0, y: 0, w: right, h: Number.isFinite(bottom) ? bottom : 0 };
}

/** `-R` string for a rect in top-left screen points, clamped to the display. */
export function regionOf(rect: {
	x: number;
	y: number;
	width: number;
	height: number;
}): string | null {
	const x = Math.round(Math.max(0, Math.min(screen.w - 1, rect.x)));
	const y = Math.round(Math.max(0, Math.min(screen.h - 1, rect.y)));
	const w = Math.round(Math.min(rect.width, screen.w - x));
	const h = Math.round(Math.min(rect.height, screen.h - y));
	if (!(w > 0) || !(h > 0)) return null;
	return `${x},${y},${w},${h}`;
}
