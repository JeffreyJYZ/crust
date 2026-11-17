# Bridge (src/bridge/ and its tests)

Area: invoke request/response pairing, ids, timeouts, event stream framing, JSON escaping both directions, malformed/oversized messages, pending-promise leaks or double resolution, swallowed error paths, platform wire-shape agreement, deadlock on a slow or missing reply.

## Findings

### 1. Token-free asset route escapes `root` on Windows via `%5c` — HIGH
`src/bridge/server/assets.ts:31-42`

The traversal guard splits on `/` only, so a URL whose decoded path segment contains a Windows separator (`/..%5c..%5csecret`) passes the `part === ".."` check, then `join(root, relative)` resolves outside `root`. The asset route is deliberately token-free (`handler.ts:43-81`), so any local process can read files outside the configured frontend directory.

**Breaks:** arbitrary local file read on Windows through `GET /..%5c..%5c<file>`; no token or origin is required.
**Evidence:** `if (key.includes("\0") || key.split("/").some((part) => part === ".."))` at `assets.ts:32`, then `const file = Bun.file(join(options.root, relative))` at `assets.ts:42`. Measured: `decodeURIComponent("/..%5c..%5csecret.txt")` is `/..\..\secret.txt`, `split("/")` yields `["", "..\\..\\secret.txt"]`, and `path.win32.join("C:\\root", "..\\..\\secret.txt")` is `C:\secret.txt`. No traversal test exists in `src/bridge/*.test.ts`.

### 2. `?window=` label breaks out of the inline bootstrap script — HIGH
`src/bridge/server/assets.ts:89`, `src/bridge/client/bootstrap.ts:38`

The document request's `window` query parameter is injected into a `<script>` body through `JSON.stringify(config)`, which does not escape `<`, `>` or `/`. A label containing `</script>` terminates the script element, so the rest of the label is parsed as HTML and any following `<script>` executes. The page's CSP permits inline scripts (`DEFAULT_CSP` has `script-src 'self' 'unsafe-inline'`).

**Breaks:** script injection in the bridge origin with the bearer token in scope; a window opened at `http://127.0.0.1:<port>/?window=</script><script>…` runs attacker JS that can call every plugin command.
**Evidence:** `const served = \`Object.assign({ window: ${PAGE_WINDOW} }, ${JSON.stringify(config)})\`` at `bootstrap.ts:38`, wrapped as `<script>${bootstrapSource(config)}</script>` at `assets.ts:89`, with `windowLabel: windowLabelFromSearch(url.search)` fed into that config at `handler.ts:54` and `handler.ts:75`. Measured: `JSON.stringify({window:"</script><script>alert(1)</script>"})` is `{"window":"</script><script>alert(1)</script>"}` — unchanged.

### 3. `crust.ready` hangs forever after a failed first invoke — MEDIUM
`src/bridge/client/invoke.ts:75-84`, `src/bridge/client/install.ts:33-41,100,133-135`

`markHandshake` is the only resolver of `ready`, and the invoke half calls it **only** on a successful `ok: true` reply. Any error reply (bad token, unknown command, handler throw, non-JSON response, network failure) throws before `onAnswer()`. When no event stream is available — no `EventSource`, or a stream rejected by the origin/token gate — no `crust:ready` frame arrives either, and `source.onerror` is an empty handler, so the page gets no signal.

**Breaks:** `await crust.ready` never settles on ordinary misconfiguration (e.g. a stale token in a dev handshake, or a command invoked before its plugin mounts), even though the page has already learned the bridge is unreachable.
**Evidence:** `if (!body || body.ok !== true) { … throw new InvokeFailure(…) }` precedes `onAnswer(); return revive(...)` at `invoke.ts:75-85`; `resolveReady` is called only by `markHandshake` at `install.ts:37-41`, and `source.onerror = () => {}` at `install.ts:135`.

### 4. Every SSE disconnect leaks a cleanup closure — MEDIUM
`src/bridge/server/events.ts:50-62,74-79`

`stream()` adds its `detached` function to `this.cleanups`, but `detached()` never removes itself. On client disconnect `cancel()` calls `detached()`, which closes the controller and drops the subscriber — yet the closure stays in `cleanups`, holding the controller and subscriber until `stop()`.

**Breaks:** an app whose page reloads or whose EventSource reconnects accumulates one retained closure per stream for the process lifetime; `stop()` also re-runs every stale cleanup.
**Evidence:** `detached = () => { this.subscribers.delete(subscriber); try { controller.close() } catch {} }` then `this.cleanups.add(detached)` at `events.ts:50-58`; `cancel: () => { detached(); }` at `events.ts:60-62` contains no `this.cleanups.delete(detached)`; only `stop()` clears the set at `events.ts:77`.

### 5. Reserved-key collisions corrupt ordinary JSON results — MEDIUM
`src/bridge/client/invoke.ts:41-47`, `src/bridge/server/bytes.ts:22-36`

The wire tag `__crustBytes` is checked on any object property at revive depth 0 and 1, with no way for a real data field to escape it. A handler returning `{ __crustBytes: "aGVsbG8=" }` as data is silently turned into a `Uint8Array`, and invalid base64 makes `atob` throw outside any `CrustError`. Separately, both walkers assign to `{}` with `out[key] = …`, so a key literally named `__proto__` changes the object's prototype instead of surviving as a field.

**Breaks:** a plugin echoing user JSON (the common `echo` shape) returns corrupted data — a string field becomes bytes or throws a bare `DOMException`, and a `__proto__` field disappears.
**Evidence:** `if (typeof value.__crustBytes === "string") return fromBase64(value.__crustBytes)` at `invoke.ts:43`, with `fromBase64` using `atob` at `invoke.ts:38-39`; `out[key] = encodeResult(record[key], depth + 1)` at `bytes.ts:33` and the matching `out[key] = revive(...)` at `invoke.ts:45`. No test covers either key.

### 6. Oversized multibyte JSON can bypass the byte cap — LOW
`src/bridge/server/invoke.ts:54-57,84-87`

The declared `content-length` guard is skipped when the header is absent (chunked bodies), and the fallback compares `text.length` — UTF-16 code units — against a limit expressed in bytes. A body of ~2 million CJK characters is ~6 MB on the wire but measures ~2 million units. The binary branch correctly uses `bytes.byteLength` (`invoke.ts:72`), so only the JSON branch is affected.

**Breaks:** a client that streams JSON without `content-length` can push several times `MAX_BODY_BYTES` through before the 413 check.
**Evidence:** `if (text.length > MAX_BODY_BYTES) { throw new CrustError("too-large", …) }` at `invoke.ts:85`, versus `if (bytes.byteLength > MAX_BODY_BYTES)` at `invoke.ts:72`. Measured: `"中".length === 1` while `Buffer.byteLength("中") === 3`.

### 7. SSE event name is interpolated into the frame unescaped — LOW
`src/bridge/server/events.ts:12-20`

`sseFrame` JSON-escapes `data` but writes `event` verbatim into the first line. Any plugin that builds an event name from dynamic text (file name, deep-link URL, user string) with an embedded `\n` injects extra SSE lines — a blank line ends the frame and the injected `data:`/`event:` lines forge frames for other subscribers. No in-repo plugin currently uses a dynamic event name, so this is a latent trap in the public `emit(event: string, …)` API rather than a live call site.

**Breaks:** corrupted or forged event frames when a plugin emits a name containing a newline.
**Evidence:** `return \`event: ${event}\ndata: ${payload}\n\n\`` at `events.ts:19`; the `JSON.stringify` guard at `events.ts:14-18` covers `data` only.

### 8. Bridge suites never exercise malformed or oversized input — LOW
`src/bridge/client.test.ts`, `src/bridge/server.test.ts`, `src/bridge/server-events.test.ts`

Every rejection code except `not-implemented` is untested at the bridge boundary: no malformed JSON, no `too-large` body, no non-JSON error reply, no missing `fetch`, no `bad-request` binary query, and no failed-invoke handshake. The size and parse guards at `invoke.ts:54-100` can be removed without reddening any bridge test.

**Breaks:** the 413/400 paths and the `ready`-on-error regression above ship unverified.
**Evidence:** `rg -n 'too-large|bad-json|bad-request|bad-response|no-fetch|oversiz|malformed|content-length' src/bridge --glob '*.test.ts'` returns only `window-label.test.ts:90` (`not-implemented`).

## Coverage

Read: every file under `src/bridge/` — client (`bootstrap`, `install`, `invoke`, `types`, `fixtures`), server (`assets`, `bytes`, `cors`, `events`, `handler`, `http`, `invoke`, `types`, `fixtures`), `server.ts`, `errors.ts`, `window-identity.ts`, and all six bridge test files. Traced the wire shapes into `src/runtime.ts`, `src/vite.ts`, `src/cli/doctor/bridge.ts`, `src/app-loop.ts` and the three `src/platform/*/platform.ts` pump implementations.

Confirmed agreements: the document, asset, invoke and event paths share the `/_crust/` prefix and the token rules (`Authorization: Bearer` for POST, `?token=` for EventSource); `window=` is appended and parsed by one module (`window-identity.ts`); `__crustBytes` depth 1 matches between `encodeResult` and `revive`; the `crust:ready` frame carries `{ port, protocol: 1 }`; the SSE data field is always JSON-escaped; the bridge runs on the same Bun event loop as the platform pump (a `setInterval` in `app-loop.ts:159-172`), so a slow handler cannot block the pump itself. There is no request-id or timeout layer in this invoke protocol: pairing is one HTTP request per call, so the "double resolve / pending id" concerns do not apply; a handler that never settles does leave the page's `invoke()` promise pending, but that is the handler's contract, not a bridge deadlock.

Not done: no source was modified, no full gate or build was run, and no single test file was executed — every finding above is from source plus the measured `bun -e` checks quoted in the evidence. Next I would run one focused test per rejection code (`bad-json`, `too-large`, binary-query `bad-request`) and a Windows-path probe against `assetBody` to confirm finding 1 end to end.
