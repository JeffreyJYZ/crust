/**
 * Dev-only page entry. It is a separate bundle from the production page, so importing the overlay
 * here cannot pull it into a production build. `perf.overlay` is the documented toggle; the page
 * implementation keeps its own handle and drives the real plugin through `invoke`.
 */
import { MARKER, mountOverlay } from "../../src/perf/overlay/overlay.ts";

const scope = globalThis as Record<string, any>;
const overlay = mountOverlay({ window: scope, dev: true });
const crust = (scope.crust ??= {}) as Record<string, any>;
const perf = (crust.perf ??= {}) as Record<string, any>;
perf.overlay = (enabled: boolean) => {
	if (enabled) overlay.show();
	else overlay.hide();
	return { enabled: Boolean(enabled) };
};
perf.readout = () => overlay.readout();
perf.marker = MARKER;
scope.__overlay = overlay;
