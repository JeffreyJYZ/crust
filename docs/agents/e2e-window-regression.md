# e2e:window regression — two defects from the hardening wave

**Root cause 1 (0 answers).** `assets.ts:133` passed a whole `<script>…</script>` element to
`injectBootstrap`, which builds that element itself. The parser ends an inline script at the first
`</script>`, so the page got `<script nonce="…"><script>(function installCrust(…` and threw
`Unexpected token '<'`: document loaded, `window.crust` never existed, every step missing.
Fix: pass `bootstrapSource(config)`. Test: `document-inline.test.ts`.

**Root cause 2 (401s after fix 1).** All windows share one `WKWebViewConfiguration`, so one
`userContentController`, and WebKit copies its scripts into each webview. Installing per window put
the isolated half on the page twice: copy one scrubbed `?token=`, copy two sent `Bearer `. Fix:
install only when the controller's script count is 0. Test: `content-world.test.ts`.

Proof: `e2e:window` 61/61, `bun test src/bridge src/platform/darwin` 335 pass, `bun check` clean.
