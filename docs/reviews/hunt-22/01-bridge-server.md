# Hunt 22 — `src/bridge/server`

Read-only hunt. Scope: every file under `src/bridge/server/` (24 source and test files).
Discovery used `rg`/`fd`; two small `bun -e` probes called the real functions directly. No source
was changed, no gate or suite was run, no GUI or cursor action occurred.

**Count: 3 findings** (0 high, 0 medium, 3 low). One is new, one is a conditional startup
race, one is a prior finding re-confirmed as still open. The core authority path is sound:
invoke authority comes from the token's bound label, not from a request field; the body cap,
origin gate, SSE teardown, byte tagging and CSP nonce all hold.

---

## F1 (low, new) — inherited property names as failure codes turn a typed refusal into HTTP 200

- `src/bridge/server/failure-status.ts:13-41` — `CONDITION` is a plain object literal, and
  `resultStatus` reads `CONDITION[answer.code]` with an untrusted string key. For any inherited
  name (`__proto__`, `constructor`, `toString`, `valueOf`, `hasOwnProperty`, …) the lookup returns
  a truthy object or function instead of `undefined`, so the `=== undefined ? 400 : …` branch is
  skipped. `statusForCode` then indexes `STATUS` with that object/function, which coerces to a
  string no key matches and returns `undefined`.
- `src/bridge/server/invoke-request.ts:48-52,79` passes that `undefined` to `jsonResponse`, whose
  `status = 200` default parameter converts it to a success status.
- Reached: a plugin or `app.command` returns `{ ok: false, code: "__proto__" }` (or any inherited
  name) as a typed failure, which is a legal shape for the many failure-returning commands.
  **Measured** against the real function: `resultStatus({ok:false,code:"__proto__"})` and
  `resultStatus({ok:false,code:"constructor"})` both returned `undefined`, while an unmapped
  ordinary code returned `400`. The body keeps `ok:false`, so a page that checks the result still
  sees the failure — but the transport-level status promised by `hunt-20/17-docs` and
  `docs/reference/api` is wrong, and a caller that keys only on HTTP status reads a refusal as
  success.
- Smallest fix: use a null-prototype lookup table (`Object.assign(Object.create(null), CONDITION)`)
  or `Object.hasOwn(CONDITION, code) ? CONDITION[code] : undefined`; make `statusForCode` fall back
  to a real status rather than returning `undefined`.

---

## F2 (low, conditional) — the dev reload watcher throws on a missing parent directory

- `src/bridge/server/events.ts:61-64,71-74` — the `Events` constructor calls
  `watch(dirname(file))` with no guard when `CRUST_DEV_RELOAD_FILE` is set. `node:fs.watch`
  throws `ENOENT` for a missing directory; there is no `try` and no fallback.
- `src/cli/dev.ts:177-184` sets that env var and calls `publishReload` fire-and-forget with
  `void`; `publishReload` (`src/cli/dev/reload.ts:34-42`) creates the directory asynchronously and
  swallows its own errors. `watchRuntime` then awaits `mkdtemp` and `spawnRuntime`
  (`src/cli/dev/runtime.ts:55-60`) before the child calls `startBridge` → `new Events()`.
- Reached: normally the awaited spawn gives `mkdir` time to finish, so the race is narrow. But if
  `publishReload` fails (unwritable project, `.crust/` removed between env set and child start) or
  a stale `CRUST_DEV_RELOAD_FILE` points at a deleted directory, the child's `startBridge` throws
  a raw `ENOENT` and the app never starts. **Measured** that `node:fs.watch` throws `ENOENT` for a
  nonexistent directory; the constructor's lack of a guard is from `read`.
- Smallest fix: try/catch the `watch` call in `watchReload` and either defer with a bounded retry
  or emit no reload events for that run, so a scratch-file problem cannot kill the bridge.

---

## F3 (low, prior finding still open) — malformed percent escape in an asset path answers 500

- `src/bridge/server/assets.ts:35` — `decodeURIComponent(pathname)` is unwrapped. A bad escape
  (`%zz`, truncated UTF-8) throws `URIError`; `handler.ts:143-145` sends it through `errorResponse`,
  and `errors.ts:78-82` maps any non-`CrustError` to `handler-error` (500).
- Re-confirmed against the real function: `assetBody("/%zz.js", { handlers: [] })` throws
  `URIError: URI error`. This is hunt-20/01-bridge LOW "Malformed percent-encoding … 500 instead
  of 400"; the code is unchanged, so it is still live. Listed here so the coordinator can see it
  was carried forward, not derived anew.
- Smallest fix: catch `URIError` around `decodeURIComponent` and throw
  `new CrustError("bad-request", …)`, as the earlier report says.

---

## Checked and clean (not counted)

- **Invoke authority binding** — `handler.ts:160-192`: `issued()` requires a token present in
  `labels`; `queryToken` is read only for `EVENTS_PATH`, so invoke cannot authenticate through
  `?token=`; `authority` comes from `labels.get(headerToken ?? …)`. The `?? token` tail is
  unreachable for invoke. `invoke.ts:53-88` checks the gate before the handler runs.
- **Origin and CORS** — `cors.ts:29-66`, `handler.ts:111-158`: absent `Origin` allowed, a present
  foreign one 403 on both the document and the general gate; only configured dev origins get
  preflight and `access-control-allow-origin`; `Origin: null` is treated as foreign.
- **Body cap and shapes** — `body.ts:14-41`, `invoke-request.ts:26-79`: streamed byte counting
  covers chunked and multibyte bodies; declared `content-length` is only an early reject; JSON
  requires string `plugin`/`command`, binary requires `?plugin=`/`?command=`.
- **SSE** — `events.ts:45-54,90-157`: `sseFrame` JSON-encodes data and strips CR/LF from event
  names; `emit` honours `desiredSize` to bound a stalled subscriber's queue; `detached()` removes
  itself from both sets and `stop()` closes every stream. No per-window event filter is expected
  (`PluginContext.emit` is app-wide by design).
- **Byte tagging / prototype safety** — `bytes.ts:30-69`: every key is written with
  `Object.defineProperty`; `__crustBytes`/`__crustLiteral` escape and the depth cap are unchanged.
- **Capability resolution** — `capabilities.ts:77-108`, `actions.ts:30-43`: no config → `OPEN`;
  non-empty → deny by default with a compiled per-label table; `app:<name>` and the legacy
  `app:invoke` candidates are both checked. The duplicate-name, grants-without-capabilities and
  coarse-`app:invoke` issues are already reported in hunt-50/15 and not re-counted here.
- **Document token ledger** — `document-tokens.ts:18-50`: FIFO cap of 256 bounds the issued-token
  map and revokes the oldest when exceeded. Revocation-at-close and eviction of live tokens are
  hunt-50/34 findings, unchanged.
- **Document serving and nonce** — `assets.ts:19-60,75-141`, `csp.ts:32-71`: path traversal is
  blocked by separator splitting plus a `resolve`/`root`/`sep` containment check; a fresh nonce
  per response is shared by the policy and the bootstrap; `jsonForScript` escapes `<`, `>`,
  U+2028/9. The seed-token mint edge (seed can mint for a request-named label) and the
  protocol-relative `Location` leak are hunt-50/33, /34 and /36 findings, unchanged. The
  non-seed-token `?window=` re-serve is explicitly blessed by hunt-50/36 and
  `capability-binding.test.ts`, so it is not called a defect here.
- **Page log route** — `page-log.ts:20-61`: closed `kind` set, length caps, and `window` taken from
  the token's label. The `?? token` fallback is examined and dismissed in hunt-21/18.

## Not done

No suite, build, typecheck or GUI probe. The three `measured`/probe statements came from
one-line `bun -e` calls importing the real modules; nothing was written to `src/`.
