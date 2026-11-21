/**
 * The read-only surface commands, split from the adapter so the open/build and commit paths stay in
 * one readable file. `capture` photographs the surface's own webview; `external` hands a refused
 * popup to the system, unless the surface's navigation policy refused that URL in the first place.
 */
import type { BrowserCapture } from "@/plugins/browser";
import { asFailure } from "@/plugins/browser-failures";
import { askDecision } from "./browser-navigation-policy.ts";
import type { BrowserPorts } from "./browser-ports";
import type { SurfaceStore } from "./browser-surface";

export function readCommands(surfaces: SurfaceStore, port: () => BrowserPorts) {
	return {
		async capture(label: string): Promise<(BrowserCapture & { ok: true }) | ReturnType<typeof asFailure>> {
			const surface = surfaces.mine(label, port());
			if ("ok" in surface) return surface;
			try {
				return { ok: true, ...(await port().snapshot(surface.web)) };
			} catch (error) {
				return asFailure(error);
			}
		},
		external(url: string): { opened: boolean; reason?: string } {
			// A `target=_blank` handoff is a navigation of the surface that asked for it: let no
			// surface's policy hand a URL it refused to the system opener.
			if (surfaces.all().some((surface) => !askDecision(surface.web, url))) {
				return { opened: false, reason: "the surface's navigation policy refused this URL" };
			}
			try {
				const outcome = port().opener(url);
				return outcome.status === 0
					? { opened: true }
					: { opened: false, reason: outcome.reason };
			} catch (error) {
				return { opened: false, reason: asFailure(error).message };
			}
		},
	};
}
