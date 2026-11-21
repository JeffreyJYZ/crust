/**
 * The decisive GTK proof for `window.capture`: take a real snapshot of the app's own WebKitWebView
 * and read back a complete PNG with real dimensions. This is the view's own render through
 * `webkit_web_view_get_snapshot`, not a screen grab, so it needs no focus and no permission grant.
 * The pump stays armed in the smoke, which is what delivers WebKit's async result to the callback.
 */
import type { LinuxShim, LinuxProofShim } from "../../src/platform/linux/shim-ffi.ts";
import type { Step } from "./proof-steps.ts";

/** WebKit's own processes are slow to start; this is a hang guard, not the normal path. */
const CAPTURE_MS = 5000;
const POLL_MS = 10;

/** The first eight bytes of every PNG, so a "picture" that is not one cannot pass. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function reason(status: number): string {
	if (status === 1) return "WebKitGTK has no get_snapshot / cairo PNG API";
	if (status === 2) return "the view is null";
	if (status === 3) return "the view is not realised";
	return `unknown status ${status}`;
}

/** Start one snapshot, wait for the callback, then marshal and check its bytes. */
export async function captureStep(shim: LinuxShim & LinuxProofShim, web: bigint): Promise<Step> {
	if (shim.shim_snapshot_ready?.() !== 1)
		return {
			ok: false,
			detail: `shim_snapshot_ready is 0 — ${shim.shim_lib_error_text?.() || "the snapshot API did not resolve"}`,
		};
	const status = shim.shim_snapshot_take?.(web) ?? 1;
	if (status !== 0) return { ok: false, detail: `shim_snapshot_take refused: ${reason(status)}` };
	const deadline = Date.now() + CAPTURE_MS;
	let state = 0;
	while (Date.now() < deadline) {
		state = shim.shim_snapshot_state?.() ?? 0;
		if (state !== 0) break;
		await Bun.sleep(POLL_MS);
	}
	if (state === 0)
		return { ok: false, detail: `the snapshot callback never answered in ${CAPTURE_MS} ms` };
	if (state !== 1)
		return {
			ok: false,
			detail: `WebKit took no snapshot: ${shim.shim_snapshot_failure?.() || state}`,
		};
	const width = Number(shim.shim_snapshot_width?.() ?? 0);
	const height = Number(shim.shim_snapshot_height?.() ?? 0);
	const scale = Number(shim.shim_snapshot_scale?.() ?? 0);
	const length = Number(shim.shim_snapshot_length?.() ?? 0);
	if (!(width > 0) || !(height > 0) || !(scale > 0))
		return { ok: false, detail: `not a picture: ${width}x${height} at scale ${scale}` };
	if (length <= 0) return { ok: false, detail: "the snapshot produced no PNG bytes" };
	const png = new Uint8Array(length);
	const copied = Number(shim.shim_snapshot_read?.(png, length) ?? -1);
	if (copied !== length) return { ok: false, detail: `read ${copied} of ${length} PNG bytes` };
	const signature = Array.from(png.slice(0, PNG_SIGNATURE.length))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	if (PNG_SIGNATURE.some((byte, index) => png[index] !== byte))
		return { ok: false, detail: `the bytes are not a PNG (signature ${signature})` };
	return {
		ok: true,
		detail:
			`snapshot of the app's WebKitWebView: ${width}x${height} at scale ${scale}, ` +
			`${length} PNG bytes, signature ${signature}`,
	};
}
