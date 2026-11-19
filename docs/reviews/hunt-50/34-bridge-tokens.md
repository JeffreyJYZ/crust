# Token and seed handling — `src/bridge/` hunt 34 (secrets with a lifetime)

Read-only hunt. `rg`/`fd` only; no files under `src/` touched.

**Count: 4 findings** (1 high, 2 medium, 1 low). Worst first.

---

## F1 (HIGH, worst) — the process seed is appended to `window.create` URLs, so a page can mint a document token for any label

The seed is the one long-lived mint credential. The bridge issues a fresh document token per
navigation, then hands that token to the page — except `window.create`, which reads the **process
seed** from a module global and writes it straight into the child window's document URL. The
document route treats that seed as a seed: it mints a token bound to the `?window=` label on the
URL. The label on a relative create URL is the `label` argument the page supplied. Nothing checks
that the caller's own bound label holds that label's grants.

- `src/bridge/window-identity.ts:48`, `:52-55`, `:58-60` — one process-wide `bridgeToken`, readable
  by any module via `currentBridgeToken()`; set from `bridge.token` for every built/plain-HTML app
  (`src/runtime.ts:134`).
- `src/plugins/window-create.ts:60` — `const token = currentBridgeToken()` (the seed, not the
  caller's document token).
- `src/plugins/window-create.ts:66-70` — for a relative URL (the default) `withForcedWindowLabel`
  writes the page-chosen `label` into `?window=`, then `withToken(labelled, token)` appends the seed.
- `src/bridge/server/handler.ts:57`, `:80`, `:87-95` — `seeds` defaults to just the process token;
  `label = windowLabelFromSearch(url.search)`; a seed + no `Origin` mints a document token bound to
  that label and 302s. The comment at `:84` claims `window.create` replaces a page-chosen `?window=`,
  but it replaces it with the page-chosen create argument.
- `src/bridge/server/invoke.ts:60-65`, `src/bridge/server/handler.ts:177` — authority is read from
  the token's bound label, so the new child genuinely carries the higher label's grants.

How reached (plain-HTML / built app, capabilities configured so the boundary is observable):

1. Configure `grants: { main: ["window:create"], admin: ["secret:*"] }` (or omit `capabilities`
   entirely — `compileCapabilities` returns `OPEN`, `src/bridge/server/capabilities.ts:80-81`).
2. A page in `main` (main-bound document token) calls
   `window.crust.invoke("window", "create", { label: "admin" })`. The call passes the capability gate
   because `main` holds `window:create`.
3. `createWindowCommand` emits `/?window=admin&token=<process seed>`; the adapter navigates the child
   to the bridge.
4. The bridge sees a seed, no `Origin`, mints a document token bound to `admin`, and redirects.
5. The child invokes `secret:*` successfully. `capability-binding.test.ts:79-85` proves `main`'s own
   token cannot do this — the seed is the only reason the boundary falls.

The process token never expires and is never rotated (`src/bridge/server.ts:40`); the same flow
works for the whole bridge lifetime. Dev-server mode is exempt (`window-identity.ts` records
`undefined` when `dev.url` is set, `src/runtime.ts:134`), which is why this hides in dev.

---

## F2 (MEDIUM) — the ledger has no revoke; a closed window's credential stays live until 256 *further* mints

`document-tokens.ts` documents the cap as the fix for "a credential copied from a closed window's
history kept its authority for the bridge's whole life" (`document-tokens.ts:2-5`). It only bounds
that lifetime; it does not end it at window close. The ledger interface exposes `remember` only
(`:13-16`), no `revoke`, and nothing in the tree calls one (`rg ledger|mintPageToken|remember` over
`src/` finds only mint sites). The bridge handle exposes `mintPageToken` but no revoke
(`src/bridge/server.ts:88-92`).

How reached: open an `admin` window (admin-bound document token), close it, copy the token out of
history, and replay it within the next 255 mints. `handler.ts:74` sees it in `labels`, `handler.ts:177`
derives `admin`, and `invoke.ts:60-65` grants `admin`'s commands. Revocation happens only on the 257th
mint via FIFO eviction (`document-tokens.ts:27-30`), unrelated to the window's lifetime.

---

## F3 (MEDIUM) — FIFO eviction removes still-live tokens; a long-running window goes 401 after 256 mints

`remember` records a token's position only at mint (`document-tokens.ts:24-31`). Re-serving a
document with an existing document token goes straight to `documentResponse` without touching the
ledger (`handler.ts:72-102`); there is no "refresh on use". Eviction deletes from the same `labels`
map the document and invoke gates read (`handler.ts:74`, `:163`, `:177`).

How reached: mint T0 for the main window on first load, then open/close 256 child windows (each
relative `window.create` navigation mints once through F1), or otherwise drive 256 seed navigations.
T0 is evicted while main is still open. Main's next reload presents T0 → `handler.ts:74` false →
401 instead of the page. The EventSource reconnect carries the same token
(`src/bridge/client/invoke.ts:183-186`), is refused at `handler.ts:163`, and `ready` stays pending
forever (`client/invoke.ts:190-192`). The app is dead until the bridge restarts — a lifetime bug in
the opposite direction from F2.

---

## F4 (LOW) — a second bridge starting and stopping clears the first bridge's recorded token

`setBridgeToken` is process-wide with no owner check (`window-identity.ts:52-55`). The clear wrapper
compares the current token to the one captured when the handle was wrapped
(`window-identity.ts:71-79`), so a bridge that starts later and stops first sets the global back to
`undefined` while the earlier bridge is still live.

How reached: bridge A starts (token A recorded), bridge B starts (token B recorded), bridge B stops
(clear matches B → `undefined`). Bridge A still serves, but `window.create` now emits URLs with no
token (`window-create.ts:70`), which the document route refuses (`handler.ts:74`). "One bridge per
process" is assumed in comments but not enforced.

---

## Checked and clean

- `nonceSource()` (`src/bridge/server/csp.ts:25-28`) draws 16 fresh random bytes per response; no
  nonce reuse, and `csp-nonce.test.ts:37-54` measures it.
- A never-issued token is refused on both gates (`handler.ts:74`, `:161-168`);
  `capability-binding.test.ts:106-115` covers it.
- A document token cannot rebind itself to another label via the document route
  (`handler.ts:87` requires a seed; `capability-binding.test.ts:119-134` covers it).
- `tokenClearedOnStop` does clear a lone bridge's token (`src/bridge/document-token.test.ts:105-124`).
