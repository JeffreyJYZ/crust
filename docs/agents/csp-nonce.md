# csp-nonce (Lane A)

- **A nonce has to be minted per*response*, not per bridge** — the CSP is built in `documentResponse`, so `startBridge` no longer resolves a single `csp` string; state carries `options.csp` only, and the default policy is composed there (`src/bridge/server/csp.ts`).
- **The document's own inline scripts must be stamped, not just the bootstrap** — `runtime.ts:107` splices the one-name `invoke` shim into `indexHtml` before the bridge ever sees it, so a nonce on the bootstrap alone would leave `INVOKE_SHIM` refused and every template's `invoke("greet")` broken. `stampInlineScripts` stamps authored `<script>` tags (skipping `src=` and an existing `nonce=`); a tag appended after parse never passes through it, which is the injection door.
- **`style-src 'unsafe-inline'` stays on purpose** — inline styles are not a script-injection vector, and removing it breaks real templates.
- **A config `security.csp` wins whole and is never rewritten** — the nonce is still computed for the bootstrap, so a caller who drops `script-src` owns the refusal.
- **`bun check` was red from a sibling lane's `src/platform/darwin/content-world-source.ts:33`** (comment text inside a JS string literal, TS1005); not mine, left alone.
- **`site/app/docs/reference/config/page.mdx:92` still quotes the old `DEFAULT_CSP` with `script-src 'self' 'unsafe-inline'`** — that page belongs to the `docs` lane, so it was reported rather than edited.
