/**
 * The one-capture read for the fullscreen instrument: start WebKit's snapshot, name a refusal with a
 * short code, and decode the bytes so a blank or 1x1 answer is never reported as a picture. Split out
 * of the probe so both files stay under the 200-line cap.
 */
import {
	darwinSnapshotShim,
	type SnapshotOptions,
	type SnapshotShim,
	takeSnapshot,
} from "@/platform/darwin/snapshot.ts";
import type { WindowSnapshot } from "@/plugins/window-types.ts";
import { decodePng, type Measured } from "../probe-capture-png.ts";

export const TIMEOUT_MS = 2500;

/** The named statuses are paragraphs; the gate line carries a code, not a speech. */
export function code(message: string): string {
	if (message.includes("never called the snapshot completion")) return "no-completion";
	if (message.includes("answered the snapshot with no image")) return "no-picture";
	if (message.includes("did not start")) return "not-started";
	if (message.includes("superseded")) return "superseded";
	if (message.includes("unsupported WebKit")) return "spi-absent";
	if (message.includes("empty PNG")) return "empty-png";
	if (message.includes("not a picture")) return "bad-dimensions";
	return message.slice(0, 70) || "unknown";
}

export interface Shot {
	ms: number;
	answer: string;
	/** The full refusal behind `answer`, so a verdict can name both the gate code and its cause. */
	message?: string;
	picture: "real" | "blank" | "1x1" | "no-png" | "decode-error";
	width: number;
	height: number;
	scale: number;
	bytes: number;
	measured?: Measured;
}

/** One capture with the caller's opt-ins; the three probe modes share this byte and decode seam. */
export async function capture(web: number, options: SnapshotOptions = {}): Promise<Shot> {
	const started = Date.now();
	let shot: WindowSnapshot | undefined;
	let answer = "ok";
	let message: string | undefined;
	try {
		shot = await takeSnapshot(web, darwinSnapshotShim() as SnapshotShim, TIMEOUT_MS, options);
	} catch (thrown) {
		message = thrown instanceof Error ? thrown.message : String(thrown);
		answer = code(message);
	}
	const bytes = shot ? Buffer.from(shot.png, "base64").length : 0;
	let measured: Measured | undefined;
	if (shot) {
		try {
			measured = decodePng(Buffer.from(shot.png, "base64"));
		} catch {
			// A decode failure is a named picture state below, not a silent success.
		}
	}
	const real =
		bytes > 0 &&
		measured !== undefined &&
		measured.pixels > 1 &&
		measured.opaque > 0 &&
		measured.colours > 1 &&
		measured.differing > 0;
	const picture: Shot["picture"] =
		!shot || bytes === 0
			? "no-png"
			: measured === undefined
				? "decode-error"
				: measured.pixels <= 1
					? "1x1"
					: real
						? "real"
						: "blank";
	return {
		ms: Date.now() - started,
		answer,
		message,
		picture,
		width: measured?.width ?? 0,
		height: measured?.height ?? 0,
		scale: shot?.scale ?? 0,
		bytes,
		measured,
	};
}

/** One pasteable fact line per capture, with every number the request asks for. */
export function line(label: string, shot: Shot): string {
	const m = shot.measured;
	return (
		`capture ${label}: ${shot.ms}ms ${shot.answer} ${shot.picture} ` +
		`w=${shot.width} h=${shot.height} scale=${shot.scale} bytes=${shot.bytes} ` +
		`pixels=${m?.pixels ?? 0} opaque=${m?.opaque ?? 0} ` +
		`colours=${m?.colours ?? 0} differing=${m?.differing ?? 0}`
	);
}
