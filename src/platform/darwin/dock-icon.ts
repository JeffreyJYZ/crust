/**
 * The dock icon, split out of `platform.ts` when that file crossed the 200-line cap. `app.icon`
 * reached only the packaged `.app`'s `Info.plist`, so a built app showed its icon and the same app
 * under `crust dev` showed the generic one — the one place the two launches disagreed on appearance.
 */
import { shim } from "./index.ts";
import { cstr } from "./objc.ts";

/**
 * Apply `app.icon` to the dock. Called after AppKit is up, because the dock tile is live by then and
 * an `NSImage` built before it is a path nothing owns.
 *
 * A path that will not load is **named**, not swallowed: a missing file and a PNG whose bytes are
 * not an image both answer the same 0 from the C half, and a silent no-op reads as "the option does
 * not work" rather than "that path is wrong".
 */
export function applyDockIcon(icon: string | undefined): void {
	if (icon === undefined) return;
	const loaded = Number(shim().symbols.shim_app_set_icon(cstr(icon)) ?? 0);
	if (loaded === 1) return;
	console.warn(`  icon      ${icon} did not load as an image, so the dock keeps the default`);
}
