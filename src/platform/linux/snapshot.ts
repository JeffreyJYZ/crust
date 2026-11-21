/**
 * The Linux half of `window.capture`: the promise over WebKitGTK's async snapshot. The C part
 * (`shim/90_snapshot.c`) starts `webkit_web_view_get_snapshot` and encodes the result to PNG on the
 * main context; this file waits for that result and marshals the bytes into the same
 * `{ width, height, scale, png }` the macOS half answers. Nothing here reads the display.
 * The seam speaks bytes, so a fake drives the whole promise on a machine with no GTK.
 */
import { WindowAdapterError, type WindowSnapshot } from "@/plugins/window";
import { type LinuxShim, shim } from "./shim-ffi.ts";

/** `shim_snapshot_take`'s answers; only `started` means a picture is on its way. */
export const SNAPSHOT_STATUS = {
	started: 0,
	unavailable: 1,
	noView: 2,
	notRealised: 3,
} as const;

const REASONS: Record<number, string> = {
	[SNAPSHOT_STATUS.unavailable]: "WebKitGTK has no get_snapshot / cairo PNG API",
	[SNAPSHOT_STATUS.noView]: "the view is null",
	[SNAPSHOT_STATUS.notRealised]: "the WebKitGTK view is not realised",
};

/** Why a capture refused to start, including a status this build does not know. */
export function snapshotStartReason(status: number): string {
	return REASONS[status] ?? `unknown status ${status} while starting the GTK snapshot`;
}

/** How long a capture may stay unanswered before the promise fails instead of hanging. */
export const SNAPSHOT_TIMEOUT_MS = 5000;

/** What C left behind: raw PNG bytes and the numbers measured from them. */
export interface SnapshotBytes {
	width: number;
	height: number;
	scale: number;
	png: Uint8Array;
}

/** The native seam, named so a test can drive the adapter without WebKit. */
export interface LinuxSnapshotShim {
	ready(): boolean;
	take(view: bigint): number;
	/** The generation the latest take owns, and the generation that published the result. */
	generation(): number;
	resultGeneration(): number;
	state(): number;
	failure(): string;
	read(): SnapshotBytes;
}

/** The real shim, over the same symbol table the rest of the Linux adapter uses. */
export function linuxSnapshotShim(native: LinuxShim = shim().symbols): LinuxSnapshotShim {
	return {
		ready: () => Number(native.shim_snapshot_ready?.() ?? 0) === 1,
		take: (view) => Number(native.shim_snapshot_take?.(view) ?? SNAPSHOT_STATUS.unavailable),
		generation: () => Number(native.shim_snapshot_generation?.() ?? 0),
		resultGeneration: () => Number(native.shim_snapshot_result_generation?.() ?? 0),
		state: () => Number(native.shim_snapshot_state?.() ?? 0),
		failure: () => String(native.shim_snapshot_failure?.() ?? ""),
		read: () => {
			const length = Number(native.shim_snapshot_length?.() ?? -1);
			if (!Number.isFinite(length) || length <= 0)
				throw new WindowAdapterError(
					"handler-error",
					"crust: window.capture produced no PNG bytes",
				);
			const png = new Uint8Array(length);
			const copied = Number(native.shim_snapshot_read?.(png, length) ?? -1);
			if (copied !== length)
				throw new WindowAdapterError(
					"handler-error",
					`crust: window.capture read ${copied} of ${length} PNG bytes`,
				);
			return {
				width: Number(native.shim_snapshot_width?.() ?? 0),
				height: Number(native.shim_snapshot_height?.() ?? 0),
				scale: Number(native.shim_snapshot_scale?.() ?? 0),
				png,
			};
		},
	};
}

/** The page's answer: base64 text and three finite numbers a page can size an `<img>` by. */
export function snapshotFrom(bytes: SnapshotBytes): WindowSnapshot {
	const { width, height, scale } = bytes;
	if (!(width > 0) || !(height > 0) || !(scale > 0))
		throw new WindowAdapterError(
			"handler-error",
			`crust: window.capture measured ${width}x${height} at scale ${scale}, not a picture`,
		);
	if (bytes.png.length === 0)
		throw new WindowAdapterError(
			"handler-error",
			"crust: window.capture produced an empty PNG",
		);
	return { width, height, scale, png: Buffer.from(bytes.png).toString("base64") };
}

/** One capture in flight: a second cannot answer for the first, so it refuses by name. */
let inFlight = false;

/**
 * Start one snapshot and await the callback's result. The pump is armed by every running app (and
 * by the GTK smoke), so the main context delivers the callback between the polls below.
 */
export async function takeLinuxSnapshot(
	view: bigint,
	native: LinuxSnapshotShim = linuxSnapshotShim(),
	timeoutMs = SNAPSHOT_TIMEOUT_MS,
): Promise<WindowSnapshot> {
	if (inFlight)
		throw new WindowAdapterError(
			"handler-error",
			"crust: a second window.capture superseded this one before WebKit answered",
		);
	inFlight = true;
	try {
		if (!native.ready())
			throw new WindowAdapterError(
				"handler-error",
				"crust: window.capture is unavailable on GTK3",
			);
		const status = native.take(view);
		if (status !== SNAPSHOT_STATUS.started)
			throw new WindowAdapterError(
				"handler-error",
				`crust: window.capture did not start: ${snapshotStartReason(status)}`,
			);
		// The callback that answers must belong to this take. `inFlight` only stops a second JS
		// call while this promise is pending; once a timeout clears it, a late callback from this
		// take could otherwise be read by the next one.
		const generation = native.generation();
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const state = native.state();
			if (state !== 0 && native.resultGeneration() !== generation)
				throw new WindowAdapterError(
					"handler-error",
					"crust: window.capture was answered by a snapshot from an earlier capture",
				);
			if (state === 1) return snapshotFrom(native.read());
			if (state === 2)
				throw new WindowAdapterError(
					"handler-error",
					`crust: window.capture — ${native.failure() || "WebKit took no snapshot"}`,
				);
			await Bun.sleep(5);
		}
		throw new WindowAdapterError(
			"handler-error",
			`crust: the GTK snapshot did not answer within ${timeoutMs} ms`,
		);
	} finally {
		inFlight = false;
	}
}
