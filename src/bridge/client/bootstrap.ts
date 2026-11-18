/**
 * The source text a page is given: the served document's inline script, or the
 * one `crust/vite` injects into a dev-server page.
 *
 * Both halves of the client are serialised here, because each is
 * `Function.prototype.toString()` and neither may reference module scope: the
 * invoke half is handed to `installCrust` as an argument.
 */

import { installPageA11y } from "./a11y-page.ts";
import { installCrust } from "./install.ts";
import { installInvoke } from "./invoke.ts";
import type { CrustConfig } from "./types.ts";

/**
 * The window identity a page reads for itself, as one expression.
 *
 * It is evaluated in the page, not here, so the same snippet works for a
 * document the bridge served and for a dev-server page the bridge never saw. It
 * runs once at install, so a client-side route change cannot lose the label.
 */
const PAGE_WINDOW =
	'(function (s) { var v = new URLSearchParams(s).get("window"); ' +
	"return v && v.trim() ? v.trim() : undefined; })(location.search)";

/**
 * The token the bridge put on the document URL, read the same way the label is.
 *
 * The document route refuses a request that cannot present it, so a page that
 * loads at all has one in `location.search`. Reading it here rather than
 * serialising it into the script is what makes the token stop being decorative:
 * fetching `/` no longer hands the credential to whoever asked, because the
 * response is a `401` unless the request already had it.
 */
const PAGE_TOKEN =
	'(function (s) { var v = new URLSearchParams(s).get("token"); ' +
	"return v && v.trim() ? v : undefined; })(location.search)";

/**
 * Serialise a config for a `<script>` body.
 *
 * `JSON.stringify` leaves `<`, `>` and `/` alone, so a `window` label containing `</script>`
 * closes the element and the rest of the label parses as HTML — then any `<script>` it carries
 * runs. Every `<` and `>` becomes its JSON escape, and U+2028/U+2029 are escaped because they are
 * line terminators inside a script. The result still parses as the same JSON value.
 */
function jsonForScript(value: unknown): string {
	return JSON.stringify(value)
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e")
		.replace(/\u2028/g, "\\u2028")
		.replace(/\u2029/g, "\\u2029");
}

/**
 * The source the served document carries.
 *
 * `installCrust.toString()` is not pretty, but it is the same function the
 * server's tests exercise, so the page cannot drift from the tested client.
 *
 * The config is the bridge's own `{ baseUrl, token, port, window }` — `window`
 * read from the document request, so it is the bridge's observation rather than
 * the page's claim — with the page's own URL as the fallback for a document
 * served without one. `Object.assign` puts the bridge first so a config that
 * names a window wins over the URL.
 */
export function bootstrapSource(config: CrustConfig): string {
	const served = `Object.assign({ window: ${PAGE_WINDOW}, token: ${PAGE_TOKEN} }, ${jsonForScript(config)})`;
	return `(${installCrust.toString()})(${served}, window, ${installInvoke.toString()}, ${installPageA11y.toString()});`;
}

/**
 * The client alone, for a page the bridge did not serve.
 *
 * `crust/vite` injects `window.__CRUST__` and then this, so a dev-server
 * document installs the same client with no second copy of the invoke path. The
 * window label can only come from the page's own URL here: the bridge never saw
 * this document, and the document's `referrer-policy: no-referrer` means the
 * invoke request carries no URL for the bridge to read either.
 */
export function pageClientSource(): string {
	const dev = `Object.assign({ window: ${PAGE_WINDOW} }, window.__CRUST__)`;
	return `(${installCrust.toString()})(${dev}, window, ${installInvoke.toString()}, ${installPageA11y.toString()});`;
}
