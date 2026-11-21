/**
 * The served document's policy, and the nonce that makes its inline bootstrap legal.
 *
 * `script-src 'unsafe-inline'` would let any injected `<script>` run, so the default carries a
 * per-response nonce instead: the bootstrap is the only inline script a served document has, and a
 * tag without the nonce is refused by the engine. `style-src` keeps `'unsafe-inline'` because real
 * templates are full of inline styles and a style is not a script-injection door.
 *
 * A config that sets `security.csp` replaces the whole string; the nonce is still generated for the
 * bootstrap, but that caller then owns the consequence, and nothing here rewrites their policy.
 *
 * `media-src 'self' blob:` is not decoration: `media-src` falls back to `default-src`, and `'self'`
 * does not match a `blob:` URL, so without this line a page that records through `MediaRecorder` and
 * plays the take back from `URL.createObjectURL` is refused by spec — which reads as the framework
 * blocking audio. `blob:` is the page's own bytes, not a new network origin, and the script door
 * (`script-src` plus the nonce) is untouched.
 */

/** The measured policy minus the nonce; `defaultCsp(nonce)` is what a response carries. */
export const DEFAULT_CSP = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data:",
	"media-src 'self' blob:",
	"connect-src 'self'",
	"base-uri 'none'",
	"form-action 'none'",
	"frame-ancestors 'none'",
].join("; ");

/** 16 random bytes, base64: the value a CSP nonce and the bootstrap's `nonce=` attribute share. */
export function nonceSource(): string {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
}

/** The default policy with `nonce` admitted on `script-src`. Two calls never share a value. */
export function defaultCsp(nonce: string): string {
	return DEFAULT_CSP.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`);
}

/**
 * The one line `crust dev` prints when a dev server — not the bridge — serves the page.
 *
 * `dev.url` puts the document on that server, whose headers crust cannot set, so the run carries no
 * crust policy at all while the built app carries `DEFAULT_CSP` (`connect-src 'self'`). That is the
 * whole of the asymmetry: a provider call that works here is refused after `crust build`, and the
 * console is not the place it fails. Serving a matching policy instead would mean proxying the dev
 * server, which changes its HMR and origin; so the asymmetry is made loud at startup.
 */
export function devCspNotice(pageUrl: string, csp: string | undefined): string {
	const enforced =
		csp === undefined ? "the default policy (connect-src 'self')" : "your security.csp";
	return `no CSP in dev — ${pageUrl} serves this page, so the built app enforces ${enforced}; an external provider that works here can fail there`;
}

/**
 * Stamp every inline `<script>` in the served markup with the response's nonce.
 *
 * The document is the app's own file, and legitimate inline scripts live in it: the runtime's
 * one-name `invoke` shim is spliced into `indexHtml` before the bridge sees it, and a plain-HTML
 * template may hold its own. Those are authored, not injected. A tag appended *after* the parser
 * ran — the actual script-injection door — never passes through here and carries no nonce.
 *
 * A tag with `nonce=` keeps its own value and one with `src=` needs none.
 */
export function stampInlineScripts(html: string, nonce: string): string {
	return html.replace(
		/<script(?![^>]*\b(?:nonce|src)\s*=)([^>]*)>/gi,
		(_match, rest: string) => `<script nonce="${nonce}"${rest}>`,
	);
}
