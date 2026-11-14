/**
 * The source text a page is given: the served document's inline script, or the
 * one `crust/vite` injects into a dev-server page.
 */

import { installCrust } from "./install.ts";
import type { CrustConfig } from "./types.ts";

/**
 * The source the served document carries.
 *
 * `installCrust.toString()` is not pretty, but it is the same function the
 * server's tests exercise, so the page cannot drift from the tested client.
 */
export function bootstrapSource(config: CrustConfig): string {
	return `(${installCrust.toString()})(${JSON.stringify(config)}, window);`;
}

/**
 * The client alone, for a page the bridge did not serve.
 *
 * `crust/vite` injects `window.__CRUST__` and then this, so a dev-server
 * document installs the same client with no second copy of the invoke path.
 */
export function pageClientSource(): string {
	return `(${installCrust.toString()})();`;
}
