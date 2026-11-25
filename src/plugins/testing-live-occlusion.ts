/**
 * The live proof's private-WebKit-SPI holder. `_setWindowOcclusionDetectionEnabled:` has no getter,
 * so this override is recorded with the process owner: a capture that opts in shares the count and
 * never re-enables detection under the running page. The webview sits off every display and is never
 * activated, but WebKit suspends its display link without this, so no evaluate can be trusted.
 */

import { perfNative } from "../cli/perf/perf-native.ts";
import { occlusionOwner, type OcclusionSender } from "../platform/darwin/occlusion.ts";

const holder = Symbol("testing-live holder");

/** Off before the first evaluate. Re-acquiring the same holder is a no-op on a view already held. */
export function disableOcclusion(web: number): boolean {
	const native = perfNative();
	const send: OcclusionSender = (target, enabled) =>
		native.perf_occlusion(target, enabled ? 1 : 0) === 1;
	return occlusionOwner.acquire(web, holder, send);
}

/** Re-send the disable at first visibility, without changing the owner's count. */
export function reassertOcclusion(web: number): void {
	occlusionOwner.reassert(web);
}

/** Only the last holder out restores WebKit's default; call in `finally`, before the window closes. */
export function releaseOcclusion(web: number): void {
	occlusionOwner.release(web, holder);
}

/** The assertion a raw selector call cannot satisfy: the owner must know about this override. */
export function occlusionHolds(web: number): number {
	return occlusionOwner.holds(web);
}

/** WebContent can nap while our own pump keeps ticking; hold the perf recorder's activity. */
export function keepAwake(): number {
	return perfNative().perf_keep_awake();
}

/**
 * The selector is private SPI, so its presence varies by macOS. A throwaway webview answers before
 * `skipIf` registers the test. The result is class-level, so no window state can make it appear.
 */
export async function occlusionSelectorAvailable(): Promise<boolean> {
	if (process.platform !== "darwin") return true;
	try {
		const { shim } = await import("../platform/darwin/index.ts");
		const { S: ObjC } = await import("../platform/darwin/objc.ts");
		const configuration = Number(shim().symbols.shim_webview_configuration() ?? 0);
		const web = Number(shim().symbols.shim_webview_new(configuration, 10, 10) ?? 0);
		if (web === 0) return false;
		const available = disableOcclusion(web);
		if (available) releaseOcclusion(web);
		ObjC.v0(web, "release");
		return available;
	} catch {
		return false;
	}
}
