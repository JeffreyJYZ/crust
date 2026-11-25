/**
 * The one owner of crust's WebKit occlusion overrides. `_setWindowOcclusionDetectionEnabled:` is a
 * void setter with no getter, so no caller can ask WebKit what state it replaced. Whoever turns
 * detection off must remember that it did, and only the last one out may restore WebKit's default.
 *
 * Both the perf harness (off for a whole run) and `window.capture ignoreOcclusion` (off for one
 * render) acquire here. A capture inside a perf run raises the count and lowers it again without
 * sending anything, so the screenshot cannot re-enable detection under the profiler. Holders are
 * keyed by webview pointer because the selector is per-view, while the ownership rule is shared.
 */
export type OcclusionSender = (view: number, enabled: boolean) => boolean;

export interface OcclusionOwner {
	/**
	 * Add a holder. Only the first holder on a view sends the disable; the selector must exist or
	 * the holder is not recorded and the caller gets false, so a WebKit update answers by name.
	 * Re-acquiring with the same holder is a no-op, which is what a per-tick re-assert needs.
	 */
	acquire(view: number, holder: symbol, send: OcclusionSender): boolean;
	/** Drop a holder. Only the last one out sends the enable that restores WebKit's default. */
	release(view: number, holder: symbol): void;
	/** Re-send disable for a view crust still holds, without changing the count. */
	reassert(view: number): void;
	/** How many crust holders still want detection off; a test's view of the ownership. */
	holds(view: number): number;
}

function first(set: Map<symbol, OcclusionSender>): OcclusionSender | undefined {
	return set.values().next().value;
}

function owner(): OcclusionOwner {
	/** The whole state there is. A fresh owner gets a fresh map. */
	const byView = new Map<number, Map<symbol, OcclusionSender>>();
	return {
		acquire(view, holder, send) {
			let set = byView.get(view);
			if (set === undefined) {
				set = new Map();
				byView.set(view, set);
			}
			if (set.has(holder)) return true;
			if (set.size === 0) {
				if (!send(view, false)) return false;
			}
			set.set(holder, send);
			return true;
		},
		release(view, holder) {
			const set = byView.get(view);
			if (set === undefined) return;
			const send = set.get(holder);
			set.delete(holder);
			if (set.size === 0) {
				byView.delete(view);
				send?.(view, true);
			}
		},
		reassert(view) {
			const set = byView.get(view);
			if (set === undefined || set.size === 0) return;
			first(set)?.(view, false);
		},
		holds(view) {
			return byView.get(view)?.size ?? 0;
		},
	};
}

/** The process-wide owner of WebKit's `_setWindowOcclusionDetectionEnabled:` override. */
export const occlusionOwner: OcclusionOwner = owner();

/** A fresh, empty owner for a unit test that must not see another test's holders. */
export function isolatedOcclusionOwner(): OcclusionOwner {
	return owner();
}

/**
 * The same one-owner rule for the harness-only composited-bit override. It is a different setter on
 * a different object, so it needs its own holder set: two probes in one process must not clear each
 * other's bit. Sharing the type keeps the ref-count rule identical.
 */
export const primeOwner: OcclusionOwner = owner();

/** A fresh, empty prime owner for a unit test that needs isolation. */
export function isolatedPrimeOwner(): OcclusionOwner {
	return owner();
}
