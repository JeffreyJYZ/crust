/**
 * What a run does with the configured windows: the URL each one loads and the create loop. Split out
 * of `app-loop.ts` when the frame restore pushed it past the line cap; `app-loop.ts` re-exports both,
 * so every caller and test keeps its import.
 */

import type { BridgeTarget } from "@/bridge/server.ts";
import { withToken, withWindowLabel } from "@/bridge/window-identity.ts";
import type { CrustConfig, WindowConfig } from "@/config";
import type { Platform } from "./app-types.ts";
import type { FrameMemory } from "./plugins/window-frame-memory.ts";

/**
 * An absolute URL is mandatory: the platform hands it to `NSURL` as-is, and a
 * relative one becomes `about:blank` there. `dev.url` wins verbatim (it is the
 * Vite origin), otherwise the window is served by the bridge.
 *
 * The document carries the window's identity: `?window=<label>` is appended
 * when the configured URL names no window, so the page reads its own label back
 * from `location.search` and the bridge can inject it into the client. A URL
 * that already names its own `window` is left byte-exact.
 *
 * A bridge-served URL also carries `?token=<token>`: the document route refuses a request that
 * cannot present one, so a page fetched without it is a `401` — and a local process fetching `/`
 * never receives the credential. A dev-server page is served by Vite, so it needs no token.
 */
export function windowUrl(
	window: WindowConfig,
	devUrl: string | undefined,
	bridge: BridgeTarget | undefined,
): string {
	const path = window.url ?? "/";
	if (devUrl) return withWindowLabel(devUrl, window.label);
	if (!bridge) {
		throw new Error(
			"crust: no page URL — set dev.url, or start through `crust dev` / a built app " +
				"so the bridge can serve the page",
		);
	}
	const url = `${bridge.url.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
	return withToken(withWindowLabel(url, window.label), bridge.token);
}

/**
 * Create every configured window and say so, so a silent window is visible.
 *
 * A `crust dev` run hands in its frame memory: each label's saved frame is read first and applied
 * once the window exists, through the platform's window-state adapter, so a restarted child reopens
 * where the human left it. The frame is applied here and nowhere later, which is what keeps a
 * page's own `window.setSize` authoritative for the rest of the run. A saved frame the memory
 * refuses — because no display still shows it — never reaches a window, so the configured size is
 * the fallback rather than an off-screen window.
 */
export async function openWindows(
	platform: Platform,
	config: CrustConfig,
	bridge: BridgeTarget | undefined,
	memory?: FrameMemory,
): Promise<void> {
	const saved = memory === undefined ? {} : await memory.restorable();
	for (const window of config.windows) {
		platform.createWindow({
			...window,
			url: windowUrl(window, config.dev?.url, bridge),
		});
		const frame = saved[window.label];
		if (frame !== undefined && memory !== undefined) {
			try {
				memory.place(window.label, frame);
			} catch {
				// One frame the platform refuses is that window at the configured size, never a
				// failed launch: the window is already up and the human can move it.
			}
		}
		// A window that exists but never appears is the worst failure: the page runs, the
		// bridge answers, and the screen is empty. Say what was created so a silent window
		// is visible in the log rather than inferred from a user's "nothing happened".
		const restored =
			frame === undefined
				? ""
				: `, restored ${frame.width}x${frame.height} at ${frame.x},${frame.y}`;
		console.log(`  window    ${window.label} created${restored}`);
	}
	memory?.observe();
}
