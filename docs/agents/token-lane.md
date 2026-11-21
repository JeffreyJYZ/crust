# token lane — fix wave 2, Lane A

Scope: `20-security.md` finding 1 — the bridge served its bearer token to anything that fetched `/`.
Owned files touched: `src/app-loop.ts`, `src/app.ts`, `src/app-types.ts`, `src/bridge/server.ts`,
`src/bridge/server/{handler,assets,types}.ts`, `src/bridge/client/{bootstrap,types,fixtures}.ts`,
`src/bridge/window-identity.ts`, `src/plugins/window-create.ts`, `src/runtime.ts`,
`site/app/docs/limits/page.mdx`, `docs/agents/bridge.md`, plus tests.

## Fixed

1. **Document route demands the token** — `src/bridge/server/handler.ts:47-93`. A `GET`/`HEAD` for
   `/`, `/index.html` or an extensionless client-side route now answers `401 unauthorized` unless
   `?token=` matches the bridge token. Assets stay token-free on purpose: they carry no credential
   and the page requests them with bare `<script src>` URLs that have no query string.
2. **The document no longer contains the token** — `src/bridge/server/assets.ts:80-101`. The injected
   config is `{ baseUrl, port, window? }`; `token` is gone. The page reads it from its own URL.
3. **The page reads `?token=` itself** — `src/bridge/client/bootstrap.ts:25-40,66`. `PAGE_TOKEN` is
   the twin of `PAGE_WINDOW`: one expression, evaluated in the page, so no app code changes and
   `window.crust.invoke` keeps working. `Object.assign({ window, token: <url> }, <config>)` means the
   config still wins if one is ever serialised with a token (the `crust/vite` path).
4. **`windowUrl` appends the token** — `src/app-loop.ts:43-57`. Takes a `BridgeTarget`
   (`{ url, token }`) and returns `<url><path>?window=<label>&token=<token>`. A `dev.url` page is
   served by Vite, so it is returned unchanged: no token, and the bridge still accepts it.
5. **`BridgeFactory` supplies the handle, not a URL** — `src/app-types.ts:53-59`,
   `src/app.ts:22-70,120-145`. `BridgeFactory` is `(config) => BridgeTarget`; `App` stores
   `#bridge: BridgeTarget` and `attach`/`createApp` take one.
6. **`window.create` carries the token** — `src/plugins/window-create.ts:18,60-74` plus
   `src/bridge/window-identity.ts:19-40` (`setBridgeToken`/`currentBridgeToken`).
   `src/runtime.ts:143-160` records it when a bridge starts and clears it under `crust dev`, where
   the created window resolves against a Vite page that injects its own `__CRUST__`.

## Tests added

- `src/bridge/document-token.test.ts` (14) — the whole contract: `withToken` keeps the query and the
  hash and replaces a stale token; `tokenFromSearch`; `windowUrl` puts both parameters on a
  bridge-served URL, none on a dev one, and still leaves a recorded `?window=` alone; the injected
  snippet reads `get("token")` and never contains `"token":"`; a served page's HTML never holds the
  bridge token; `window.create` appends the recorded token, and appends nothing when none is known.
- `src/bridge/server-document.test.ts` — the three document cases rewritten: no token is `401`
  (and the body never holds the token), a wrong token is `401` on `/` and on a client-side route,
  the served page carries no token but does carry `get("token")`, and a custom CSP still applies.
- Updated: `src/bridge/window-identity.test.ts`, `src/bridge/window-label.test.ts` (documents fetched
  with `?token=`), `src/bridge/client/fixtures.ts` (a served page's stub `location.search` carries
  the token, as `windowUrl` builds it), `src/app-run.test.ts` (`createApp` takes a `BridgeTarget`).

## Checks

- `bun check` — clean, 645 files.
- `bun test` on the bridge suites, `src/app-run.test.ts` and `src/plugins` — 735 pass / 0 fail.
- `bun fmt <each touched file>` — applied per file, never tree-wide.
- `bun run check:lines` — my files are all ≤ 200 (`src/runtime.ts` 200, `src/app-loop.ts` 197,
  `handler.ts` 137). It reports one **foreign** failure: `src/bridge/capabilities.test.ts` 211 lines,
  an untracked file another lane is writing.
- Not run, per the brief: full suite, `bun run e2e`, any build.

## Not fixed, and why

- **`20-security.md` finding 4** (the docstring claiming an absent `Origin` is refused) is already
  correct in `src/bridge/server.ts:3`, and finding 3 (`0600` on the dev handshake) is already in
  `src/runtime.ts` from the bridge lane. No change needed.
- **`window.create`'s token plumbing goes through `window-identity.ts`** rather than a parameter: the
  plugin's construction sites (`runtime-plugins.ts`, `plugins/index.ts`, examples) are not in this
  lane's file set, and a signature change there would break four callers owned by other lanes.

## Durable notes

- The document is the only route whose response *is* a credential, so it is the only route that must
  demand one before answering. Assets are not in that class.
- `withToken` **replaces** an existing `token` parameter rather than appending beside it: the token is
  the bridge's to define, and a stale one on an app-configured URL would shadow the live credential
  and turn every page load into a `401`.
- A test double that installs the served client must put the token in its stub `location.search`,
  because that is the only place a real page can get one from.
