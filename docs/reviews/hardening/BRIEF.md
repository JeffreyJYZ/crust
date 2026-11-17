# Two hardening lanes: a CSP nonce, and capabilities in the templates

Read `../fix-wave/BRIEF.md` for house rules.

## Why

`script-src 'self' 'unsafe-inline'` means an injected `<script>` tag runs. That is the one door left
open after the token moved off the document, and it is closed by a nonce rather than by changing the
transport.

The permission model exists but nothing uses it: every scaffold ships with no `security` block, so an
app starts permissive and stays that way. A template that demonstrates the model is how an author
learns it exists.

## Lane A — a per-launch nonce

- `documentResponse` generates a nonce once per response (16 random bytes, base64), passes it to
  `injectBootstrap` so the injected `<script>` carries `nonce="…"`, and builds the CSP with
  `script-src 'self' 'nonce-<nonce>'`.
- `'unsafe-inline'` is **removed** from `script-src` for served documents. A `<script>` without the
  nonce is then refused by the engine.
- Keep `style-src 'unsafe-inline'` — inline styles are everywhere in real templates and are not the
  script-injection door.
- `injectBootstrap(html, snippet)` gains the nonce: the snippet it builds is
  `<script nonce="…">…</script>`.
- `pageClientSource()` (the Vite path) is unchanged: the dev server owns that document, and its CSP is
  Vite's.
- **The CSP the app sees must still be overridable.** `security.csp` in config wins; when an app sets
  its own CSP the nonce is still computed, but a caller who replaces `script-src` owns the consequence.
  Document that rather than silently rewriting their string.

Tests that must exist:
- a served document's `<script>` carries the nonce, and the CSP header contains the same value
- the nonce differs between two responses
- a document served twice does not reuse the first nonce
- `script-src` no longer contains `'unsafe-inline'`
- a page with its own inline script and no nonce is *not* granted permission — assert the CSP string,
  because the engine refusal needs a real browser and belongs to an e2e

## Lane B — capabilities in all five templates

Every scaffold `crust init` writes gains a `security` block that grants its own window the commands
its page actually uses:

```ts
security: {
	capabilities: [
		{ name: "ui", actions: ["dialog:*", "notification:*", "clipboard:*"] },
	],
	grants: { main: ["ui"] },
},
```

Rules:
- **The grant must cover what the template's own page and `main.ts` call.** Read each template's
  `public/app.js` / `src/main.tsx` / `app/page.tsx` and list the commands it actually invokes — a
  scaffold that refuses its own page on first run is worse than no sample.
- **Five templates**: `default`, `react`, `next`, `svelte`, `vue`.
- A template that only calls an app command needs no capability at all; say so in a comment rather
  than inventing a grant.
- `scripts/build-standalone.ts` pins file counts per template; do not change any file count, only
  content.

Tests that must exist:
- for each of the five templates, the emitted `crust.config.ts` validates and the grant names a
  capability that exists
- a template's declared capabilities actually cover every command its page calls — read the page
  source, extract `invoke("plugin", "command")` / `invoke("name")`, and assert each is granted
- `crust init` in a temp dir produces a config that `validateConfig` accepts

## Proof

Each lane: own tests, `bun check`, `bun run test`, `bun fmt <files>`, `bun run check:lines`,
`bun run check:links` if `site/` changed. Lane A also updates the limits page paragraph about CSP.
