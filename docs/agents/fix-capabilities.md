# Lane: fix-capabilities (F1)

Read 2026-11-18 against `0e8d2c2`. Field: capability authority must come from the credential, not a request field.

- Defect `docs/reviews/next-wave/defects.md` §1: `invoke.ts:49` gated on the label from the invoke body while `server.ts:38` minted one process token. A page on Linux/Windows/Vite holds that token and could claim any label. Probe `capability-spoof.test.ts` was red (spoofed `window:"admin"` answered 200).
- Fix shape: `server.ts` records `token → label` in `BridgeState.labels`; the process token is bound to `DEFAULT_WINDOW_LABEL` ("main") for the dev-server path; `serveDocument` mints a fresh `crypto.randomUUID()` bound to the document's `?window=` and redirects the navigation URL onto it so the page reads that token from `location.search`. Invoke accepts only issued tokens and gates on the bound label.
- `Run` now takes two labels: `routing` (body/query, feeds `ctx.window`) and `authority` (bound to the token, feeds `capabilities.allows`). The body label still routes `window.label`; it never grants.
- A label-less document binds to `main`, not to `undefined`. The old test "no window label holds nothing" was rewritten to grant only `admin` and assert the body's `admin` cannot widen a `main`-bound token.
- Trap: `withToken`/`windowUrl`/`documentResponse` are outside this lane. Do not change `withToken` — its unit tests pin exact strings (`?token=abc`). The redirect keeps the credential out of the HTML and needs no change to asset serving.
- Trap: a page holding its own document token could otherwise fetch `/?token=<its token>&window=admin` with `redirect:"manual"` and read a freshly minted admin token off the redirect. Mint only from the process token, and only when no Origin header is present (top-level navigation); a document token only re-serves its own document, its binding never changes. Both cases have tests.
- Dev-server limitation: Vite pages use the process token and therefore get the default label's grants; a configured capability set that grants only a non-`main` label will refuse them. Open (default) capabilities are unaffected.
- Proof: `bun test docs/reviews/next-wave/probes/capability-spoof.test.ts` green; `src/bridge/capability-binding.test.ts` proves a second window's document gets only its own grants and that the body label still routes. Scoped `bun check` clean; `bun run check:lines` PASS.
