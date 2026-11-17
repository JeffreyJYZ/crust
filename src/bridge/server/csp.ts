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
 */

/** The measured policy minus the nonce; `defaultCsp(nonce)` is what a response carries. */
export const DEFAULT_CSP = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data:",
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
