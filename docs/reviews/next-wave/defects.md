# Next wave — Lane 2: defects

Correctness and security defects in the code as it stands. No features, no fixes.
Everything below is either a code path traced end to end or a red probe under
`docs/reviews/next-wave/probes/` (not collected by `bun test` or `bun check`).

Method: `bun test docs/reviews/next-wave/probes/` — 1 pass (control), 4 fail
(three defects, each asserted to the secure behaviour). Tree left unchanged
outside this lane's paths. Line numbers from the current checkout at
`0e8d2c2`.

## 1. HIGH — capability grants are bypassable by claiming another window label

**Where.** `src/bridge/server/invoke.ts:48-51` checks
`capabilities.allows(window, action)` using the `window` argument, and
`:125-130` takes that argument straight from the request body
(`asWindowLabel(parsed.window)`). `src/bridge/server.ts:38` mints **one**
`crypto.randomUUID()` token for the whole process, and
`src/bridge/server/handler.ts:118-126` gates invoke on that one token alone.
`src/bridge/server/capabilities.ts:12-13,96-100` uses the label as the sole
authorisation key.

**Wrong.** The label is a page-supplied string, not an authenticated identity.
`src/bridge/window-identity.ts:15-18` even states "a label is a routing hint,
never authority … nothing about a label is a security boundary" — the direct
opposite of what the capability gate does. Any holder of the shared token can
choose any label.

**Reached.** On Linux, Windows and Vite-dev pages the bearer token is in the
page's own world (`src/bridge/client/install.ts:139` returns it on the
non-realm path; it is also in `location.search`). Page script can POST
`/_crust/invoke` itself with `{"plugin":"test","command":"secret","window":"admin"}`
and receive the `admin` grant. Only macOS with the content world is immune:
`src/platform/darwin/content-world-source.ts:32,77` fixes the label in the
isolated world and scrubs the token before page scripts run.

**Evidence.** `docs/reviews/next-wave/probes/capability-spoof.test.ts`. A bridge
with `grants: { main: ["safe"], admin: ["secret"] }`; the `main` token gets 403
for `test:secret`, then the **same token** with `window: "admin"` gets 200 and
the secret. Probe asserts the secure answer (403), so it is red:

```
(fail) capability label is taken from the request body > a page that claims the admin label reaches it with the same token
```

**Smallest fix.** Bind the label to the credential: mint a token per document
window (or record token→label at `serveDocument` in `handler.ts:52-65`) and use
that bound label for `capabilities.allows`, ignoring the body field for
authorisation. If that binding is out of scope, stop describing capabilities as
authorisation and drop the gate rather than ship a decorative one.

## 2. HIGH — `updater.check` fetches arbitrary page-supplied URLs

**Where.** `src/plugins/updater.ts:69,76` reads `endpoint` from the args and
calls `adapter.fetchJson(endpoint)` with no URL check. The default adapter is a
bare `fetch(url)` (`src/plugins/updater-node.ts:57-68`). The scheme policy that
`download` applies (`src/plugins/updater-download.ts:35` →
`src/plugins/updater-url.ts:19-39`, https only, file on opt-in) is never applied
to `check`.

**Wrong.** The comment in `updater-url.ts:3-5` says a page-supplied URL without
scheme restriction reads any path on disk and reaches loopback ports; `check`
has exactly that hole. The app's `fetch` is not CORS-bound, so the page also
reads a response it could not fetch itself. With capabilities open by default
(`capabilities.ts:8-10`) every app is exposed, not only those using updater.

**Reached.** `updater.check({ endpoint: "http://127.0.0.1:<port>/manifest.json",
currentVersion: "1.0.0" })` returns the endpoint's JSON as a normal update
result. A `file:` endpoint reaches local files where Bun's fetch permits it.

**Evidence.** `docs/reviews/next-wave/probes/updater-check-ssrf.test.ts`: a loopback
HTTP server returns a manifest; `check` answers `{ available: true, ... }` where
the probe expects a refusal. Red:

```
(fail) updater.check endpoint URL policy > an http loopback endpoint is refused the way download refuses it
```

**Smallest fix.** Run `endpoint` through the same `downloadUrlFailure` policy
before `fetchJson` (rename it to `fetchUrlFailure` and use it in both places).
Keep the `allowFileUrl` opt-in shared.

## 3. MEDIUM — shell env injection blocklist is case-sensitive on Windows

**Where.** `src/plugins/shell-env.ts:9-25` compares exact uppercase names and an
exact `DYLD_` prefix. `src/plugins/shell.ts:93` merges the accepted object into
`process.env` for the spawn. Tests only ever use uppercase spellings
(`src/plugins/shell-env.test.ts:32-50`).

**Wrong.** Windows environment names are case-insensitive, so
`node_options=--require …` and `dyld_insert_libraries=…` are the variables the
runtime reads, but the filter lets them through. The allow list then bounds
nothing: an allowlisted `node` becomes arbitrary code execution.

**Reached.** Only with the host's `createShellPlugin({ env: true })` opt-in, but
that opt-in is exactly where the blocklist is the only remaining guard.

**Evidence.** `docs/reviews/next-wave/probes/shell-env-case.test.ts`, both cases
red:

```
(fail) shell env injection blocklist > lowercase spelling of NODE_OPTIONS is refused
(fail) shell env injection blocklist > lowercase spelling of a DYLD_ variable is refused
```

**Smallest fix.** Fold the key once (`key.toLowerCase()`), compare against a
lowercased `INJECTION` set and a lowercased `dyld_` prefix. Names in refusal
messages stay as the caller wrote them.

## 4. MEDIUM — keychain.list silently drops account names over 255 bytes

**Where.** `src/platform/darwin/shim/119_keychain_b.c:104-105` copies each
account into a fixed stack `char small[256]` with
`CFStringGetCString(name, small, 256, SHIM_KCF_UTF8)`; a longer name makes the
call fail and the loop `continue`s, dropping the account. The TS adapter's
exact-length re-read (`src/platform/darwin/keychain.ts:84-94`) only grows its
buffer when the **total** exceeds `cap`; it cannot recover a name the C half
never reported.

**Wrong.** An account that `keychain.set` accepts (the plugin only checks
non-empty and no NUL, `src/plugins/keychain.ts:56-60`) can be fetched by
`keychain.get` but is invisible to `keychain.list`, so enumeration is not a
complete view of the store. The C comment claims "a short buffer yields fewer
accounts", which describes the `dst` overflow guard, not this separate hard
limit.

**Reached.** `keychain.set({ service:"s", account:"<300 bytes>", secret:"x" })`
then `keychain.list({ service:"s" })` on macOS.

**Evidence.** Code trace only — no probe, because reproducing it writes a real
entry to the user's login Keychain, which a probe must not do.

**Smallest fix.** Query `CFStringGetLength`, use a heap buffer sized from the
caller's remaining `cap`, and signal truncation so the adapter can re-read with
an exact buffer, as `shim_keychain_get` already does.

## 5. LOW — `MAX_BODY_BYTES` is not enforced for chunked invoke bodies

**Where.** `src/bridge/server/invoke.ts:75-78` trusts `content-length`; `:92-95`
(binary) and `:105-110` (JSON) call `request.arrayBuffer()` / `request.text()`
before checking the byte count.

**Wrong.** The comment at `:20` ("bodies over this size are refused before
parsing") holds only when the client sends `content-length`. A chunked POST
omits it, so `declared = 0` passes the pre-check and the whole body is buffered
before the 413. Token-gated loopback limits the exposure, which is why this is
low.

**Reached.** `POST /_crust/invoke` with `Transfer-Encoding: chunked` and a body
over 2 MiB.

**Smallest fix.** Read the body as a stream with a running byte counter and
abort past the cap, keeping the header check as the fast path.

## Dropped / not findings

- CSP nonce stamping, asset path traversal (`%2e%2e`, `%5c`), zip-slip and zip
  symlink escape, stronghold KDF bounds, updater signature pinning and receipt
  re-checks all hold against their tests and code; no reachable hole found.
- `shell.spawn` inherits the parent `process.env` by default. Reported here only
  as context: a host that allowlists `printenv` has opted into exposing its own
  environment. Not counted as a defect because the host chooses the list.
