# Hunt 20 — bridge server and invoke path

Field: `src/bridge/**` — capability tokens, document token binding, origin checks, wire contract,
error mapping, body size/shape, event stream, page-reachable authority.

## HIGH — Process token can mint a document token for any window label, amplifying its authority

- where: `src/bridge/server/handler.ts:78-87`, `src/bridge/server.ts:54-55`, `src/vite.ts:78`
- mechanism: The process token is bound to `main` for invoke authority (`server.ts:55`,
  `handler.ts:169`), but `serveDocument` treats *any* navigation presenting that token as licensed
  to mint a fresh token bound to whatever `?window=` the request names (`handler.ts:79-80`). The
  redirect hands that new credential back in `location`. So a token whose invoke authority is
  `main` can issue a token with another label's grants. `read` for the binding and redirect code;
  `measured` locally: with capabilities `{main:[test:echo], admin:[test:secret]}` the process token
  got `403 forbidden` on `test:secret`, while a `GET /?token=<process>&window=admin` returned `302`
  and the minted token got `200` with `SECRET`.
- reachable by: Under `crust dev`, `src/vite.ts:78` writes `window.__CRUST__ = { url, token }` with
  the *process* token into every Vite-served page, whatever its `?window=` label. A script in a
  low-grant dev page reads `window.__CRUST__.token` and sets `location.href =
  'http://127.0.0.1:<port>/?token=<that>&window=admin'`. The top-level navigation carries no
  `Origin`, passes `allowedOrigin`, mints an `admin` token, and the page now invokes with `admin`
  grants. This defeats the documented guarantee that a page holding nothing cannot call gated
  commands (`site/app/docs/guides/permissions/page.mdx:86`) even where no `main` grant covers them.
  Built apps keep the process token out of page scope, but `window.create`
  (`src/plugins/window-create.ts:70-76`) still appends it to every created window's URL, so it
  remains a minting oracle reachable from any page granted `window:create`.
- smallest fix: Separate minting authority from invoke authority. Give each window its own token at
  `windowUrl`/`window.create` time (signed to its label) so no token ever handed to a page can seed
  a different label; keep the process token host-only. At minimum, refuse a mint when the presented
  token is not explicitly marked as a seeding token.

## LOW — Issued document tokens are never revoked and the label map grows without bound

- where: `src/bridge/server.ts:54-55`, `src/bridge/server/handler.ts:80`
- mechanism: Every mint does `state.labels.set(documentToken, label)`; nothing anywhere deletes an
  entry (`rg 'labels' src/bridge` shows only `set`, `has`, `get`). Closing a window leaves its token
  valid, and create/close or navigation cycles add one UUID entry each for the bridge lifetime.
  `measured`: two mints for `admin` produced distinct tokens and both still answered `test:secret`
  with `200` after the second mint.
- reachable by: An app that opens and closes windows over a long session grows `labels` monotonically,
  and a token captured from a closed window's history or logs keeps that label's authority forever.
- smallest fix: Delete the document token from `labels` when its window closes, or give tokens an
  expiry and prune issued entries on each request.

## LOW — Malformed percent-encoding in an asset path answers 500 instead of 400

- where: `src/bridge/server/assets.ts:35`, `src/bridge/server/handler.ts:131-133`
- mechanism: `decodeURIComponent(pathname)` throws `URIError` on a bad escape (`%zz`, truncated
  UTF-8); the route's `try/catch` sends it through `toCrustError`, which maps any non-`CrustError`
  to `handler-error` (500). `measured`: `GET /%zz.js` returned
  `{"code":"handler-error","message":"URI error"}` with status 500. A client-side route is not a
  fault of the server, so a 400 `bad-request` is the correct answer.
- reachable by: Any local process requests a URL containing a malformed escape — no token needed,
  because the asset route is token-free.
- smallest fix: Wrap `decodeURIComponent` in `assetBody` and throw `new CrustError("bad-request", …)`
  on `URIError`.

## LOW — "Hostile window label" document test is vacuous

- where: `src/bridge/client-guards.test.ts:48-58`
- mechanism: The test fetches `${bridge.url}/?window=${encodeURIComponent(label)}` with no `?token=`,
  so `serveDocument` returns `401` before `documentResponse` runs, and the assertion that the HTML
  lacks the injected `<script>` passes against a JSON error body. `read` of the test and of
  `handler.ts:65-71`. A second test at `:37-46` does check `bootstrapSource` directly, so the
  escaping itself is covered; the end-to-end one is not.
- reachable by: Someone deleting `jsonForScript`'s `<`/`>` escapes would not redden this test as
  long as the 401 path stayed intact.
- smallest fix: Append `&token=${bridge.token}` to the fetch URL (and use `redirect: "follow"`),
  then assert the served HTML contains no unescaped `</script><script>`.

## Checked and clean

- **Capability matching** (`server/capabilities.ts:77-108`, `server/actions.ts:30-43`,
  `plugins/network-match.ts:23-46`): `read`. No config → `OPEN`; non-empty → deny by default with
  an exact per-label pattern table compiled once at start. `app:invoke` fine/wire candidates are
  both checked, so narrow grants work without breaking the flat alias. `*` is a literal
  prefix/suffix matcher, no regex. `caseInsensitive: false` keeps command names case-sensitive.
- **Token check on invoke/events** (`server/handler.ts:147-170`): `read`. `queryToken` is read only
  for `EVENTS_PATH`, so an invoke cannot authorize through `?token=`; `authority` comes solely from
  `labels.get(headerToken)`. Unissued UUIDs are refused (`issued()` uses `labels.has`).
- **Origin and CORS** (`server/cors.ts:29-66`): `read`. Absent `Origin` allowed (WebKitGTK
  `EventSource` sends none); a present foreign one is `403`; only configured dev origins get
  preflight and `access-control-allow-origin`. `Origin: null` is treated as foreign and refused.
- **Body size and shape** (`server/invoke.ts:95-186`): `read` plus the existing guards in
  `server-guards.test.ts`. `readCappedBody` counts raw bytes while streaming (chunked and multibyte
  cases both covered), the declared `content-length` is only an early reject, binary requests need
  `?plugin=` and `?command=`, and JSON requires string `plugin`/`command`. No body path can skip the
  cap.
- **Error mapping** (`server/errors.ts`, `server/failure-status.ts:35-41`, `server/http.ts:57-61`):
  `read`. Handler throws keep code/status/`requires` and gain a "came from the handler" note; typed
  `{ok:false,code}` results keep the body and get a transport status, with unmapped codes defaulting
  to 400. The client's `bad-response`/`no-fetch`/`ready`-on-error paths are covered by
  `client-guards.test.ts:61-111`.
- **Byte tagging and prototype safety** (`server/bytes.ts`, `client/invoke.ts:52-85`): `read` plus
  `client-guards.test.ts:113-139`. `__crustBytes`/`__crustLiteral` escape works and both walkers use
  `Object.defineProperty`, so a `__proto__` key survives as an own field. Depth is capped at 1 by
  design and documented.
- **Event stream** (`server/events.ts:82-140`): `read`. `sseFrame` strips CR/LF from event names and
  JSON-encodes data, so a plugin cannot forge frames; `detached()` removes itself from both sets, so
  reconnects do not leak; `stop()` closes every stream. Events are global by design —
  `PluginContext.emit` carries no label — so cross-window visibility is not a privilege boundary
  and is not claimed as one.
- **Document/asset serving** (`server/assets.ts:30-81`, `server/csp.ts:45-49`): `read`. Traversal is
  blocked both by splitting on `/` and `\` and by the `resolve` + `root` + `sep` containment check;
  injected and authored inline scripts share a per-response nonce; `jsonForScript` escapes `<`, `>`,
  U+2028 and U+2029. Client-side route fallback requires a valid document token.
- **Not run:** no suite, no build, no GUI probe. The two `measured` claims above came from a
  throwaway Bun script that started a bridge on loopback, minted tokens, issued POSTs and fetched
  `/%zz.js`; it stopped the bridge and exited.
