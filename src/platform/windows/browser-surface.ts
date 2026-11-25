/**
 * The one ordering rule `browser.open` has to get right: a surface and its navigation decision are
 * registered before WebView2 handlers are attached. An unmatched web pointer now fails closed, so
 * registering afterwards would cancel the surface's own first load.
 */
import type { BrowserOpenInput } from "@/plugins/browser";
import type { SurfaceStore } from "@/plugins/browser-surfaces";

import { firstLoadAware, type NavigationDecisions } from "./browser-navigation.ts";

/** Register the surface, then return the undo a failed handler attach needs. */
export function registerWindowsSurface<T>(
	store: SurfaceStore<T>,
	decisions: NavigationDecisions,
	input: BrowserOpenInput & { onNavigate?: (url: string) => boolean },
	web: T,
	owner: string,
	release: () => void,
): () => void {
	if (input.onNavigate !== undefined)
		decisions.set(input.label, firstLoadAware(input.url, input.onNavigate));
	store.set({ label: input.label, web, owner, onPopup: input.onPopup });
	return () => {
		store.delete(input.label);
		decisions.delete(input.label);
		release();
	};
}
