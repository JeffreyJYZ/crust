# 06 — reachability: pairing, and SSH/WSL

Both gaps are about who can reach the bridge. The bind is one line, so the answer is not "can a
client connect" but "which credential, scoped to what, and is it readable by the thing that shows
it".

---

## #6 — pairing (`Connect` panel: URL + token + Copy)

**Verdict: `crust feature` (small).** The URL is already readable and an external client can already
call the bridge, but nothing can *mint* a credential: a plugin has no bridge handle, and on macOS the
page is deliberately kept from ever seeing a token. A panel is buildable on Linux/Windows today by
reading `window.crust.token`; on macOS it is not buildable at all, and building it the obvious way
would hand out the one token that can mint documents for any window.

### Evidence

**Where it binds.** `src/bridge/server.ts:72-78` calls `Bun.serve({ hostname: HOST, … })`;
`HOST = "127.0.0.1"` at `src/bridge/server/cors.ts:16`. Published as a contract at
`site/app/docs/limits/page.mdx:57` and `site/app/docs/start/first-app/page.mdx:65`.

**Port is stable-ish, token is per run.** The preferred port is an FNV-1a hash of `app.id` into
45000–48999 (`src/runtime-host.ts:22-29`), walked upward on collision and falling back to ephemeral
on the 21st attempt (`src/runtime.ts:106-123`). The token is `crypto.randomUUID()` made freshly in
`startBridge`, before `serve` (`src/bridge/server.ts:40`). Nothing persists it: no config key carries
a token (there is no server/host/token section in `src/config/types.ts`, and no `validate-*.ts` for
one), and the only file that ever holds one is the dev handshake `.crust/dev.json` (0600), written
only when `dev.url` is set (`src/runtime-host.ts:61-84`, called at `src/runtime.ts:134`).

**Tokens are per document and label-scoped, not one process secret.** A navigation presenting the
process token (a seed) is answered `302` with a freshly minted document token bound to that
document's `?window=` label (`src/bridge/server/handler.ts:76-98`); `seeds` is the process token
alone (`handler.ts:58-60`). The ledger is capped at 256 and evicts the oldest
(`src/bridge/server/document-tokens.ts:11,27-30`). There is **no revoke**: `rg -n "revoke" src
--glob '!*.test.ts'` returns only that eviction comment and the `.ips`-unrelated hits, and
`rg -n "pair" src` returns nothing. A stopped bridge only drops the recorded token
(`src/bridge/window-identity.ts:71-80`).

**What a page can read about itself.** `window.crust.baseUrl` is always set, from
`resolved.url ?? resolved.baseUrl` (`src/bridge/client/install.ts:38,144`). The token is included
only when there is no content-world realm (`install.ts:26-31,146-148`), and on macOS the injected
`__CRUST__` has its token stripped (`install.ts:156-158`) while the isolated content world keeps the
credential in a closure and scrubs `?token=` before any page script runs
(`src/platform/darwin/content-world-source.ts:23-36`). Since only darwin installs `crustInvoke`
(`src/bridge/client/invoke.ts:45-46`), the honest split is:

- Linux/Windows: the page can read **its own document token** (authority = its window label) —
  because a seed navigation with no `Origin` is redirected to a minted token (`handler.ts:90-97`);
  a navigation that did carry an `Origin` would be served unredirected and the page would hold the
  seed instead, so this path depends on the top-level navigation staying origin-less.
- macOS: the page can read the URL and **no token at all**.

**An external client already works.** A request with no `Origin` is allowed on purpose — the bearer
is the credential (`src/bridge/server/cors.ts:43-49`), and `crust doctor` is proof of a non-page
client: it POSTs `/_crust/invoke` with an `Origin` header and a bearer and reads `pong`
(`src/cli/doctor/bridge.ts:72-83`). The protocol is `POST /_crust/invoke` with
`authorization: Bearer <token>` (`src/bridge/client/invoke.ts:130-139`) and
`GET /_crust/events?token=` (`src/bridge/server/handler.ts:160-177`).

**What is missing is the mint.** A plugin's context is `emit` and `window`, nothing else
(`src/plugins/define.ts:11-23`). The handle is private (`src/app.ts:48,152-153`) with no getter
(the only `get` on the class is `plugins()` at `src/app.ts:119`), and `app.deferBridge` takes a
factory crust supplies rather than exposes (`src/app.ts:75-79`). So neither page nor backend can ask
for a credential today.

**What a paired client would get.** Whatever the bound label's capabilities grant
(`src/bridge/server/capabilities.ts:8-14,77-101`) — and with no `security` section, everything
(`capabilities.ts:44-48`). That is the whole IPC surface (fs, shell, clipboard, keychain), which is
why the label must be a new one, not `main`.

### What it would take

The smallest honest design is one core plugin and one ledger method, not a new transport:

1. `DocumentTokenLedger` gains `revoke(token)` and `forget(token)` in
   `src/bridge/server/document-tokens.ts`, and the plugin calls it.
2. A `pair` plugin (`src/plugins/pair.ts`, `src/plugins/pair-types.ts`) with `mint`, `list`,
   `revoke`. `mint` calls `mintDocumentToken(ledger, "paired")` — a **document** token, never
   `bridge.token`, because a seed can mint a document for any label it names
   (`handler.ts:88-97`). Register it inside `startBridge` beside `mintPageToken`
   (`src/bridge/server.ts:82-93`), where the ledger already is, so `PluginContext` does not grow a
   bridge field and no test fake changes shape.
3. It reaches every platform unchanged: darwin routes it through `crustInvoke` exactly like any
   command (`content-world-source.ts:140-175`), and Linux/Windows through the page client.
4. `security.grants` already keys by label (`src/config/types.ts:82-87`), so an app scopes the
   paired client with `"paired": ["…"]` and no new config shape is needed.
5. Base URL is already there; **no address enumeration exists** — `os.info` reports `hostname()`
   only (`src/plugins/os.ts:129`), and `network` exposes `status` alone
   (`src/plugins/network.ts:144-177`), so a LAN address stays the app's computation.

### What breaks

- **A credential on screen is a leak surface.** It must be revocable and label-scoped, and revoking
  must be possible from the same panel that shows it; today the only revocation is cap eviction.
- **Never hand out the process token.** It seeds documents for labels the page names; a document
  token cannot (`handler.ts:58-60,88-97`).
- **The origin gate is not a second line for a paired client** — an absent `Origin` is allowed
  (`cors.ts:47`), so the token is the entire defence.
- **Do not add a second credential store.** The ledger is the one home; a persistent token would be
  a long-lived secret and belongs in `keychain` (`src/plugins/keychain.ts:120`) if it is ever
  wanted, not in config.
- File sizes leave room: `startBridge` is 94 lines and the ledger 50, so a plugin + types + a test
  file fits the 200-line cap.

### Estimate

**M.** One small plugin, one ledger method, a capability label in docs, and tests on three serving
paths (darwin realm, Linux fetch, dev handshake) — nothing native, nothing per OS.

### What stays the app's job

The panel UI, the QR payload and its encoding, what a paired client may call (its grants), and the
protocol the client speaks: crust's bridge is IPC, not a product API. There is no custom-route seam
— only assets, the document and `/_crust/*` are served, everything else is `not-found`
(`src/bridge/server/handler.ts:28-29,111-146,195`) — so an app that wants to be paired *as a server*
must expose its own API itself.

---

## #7 — SSH / WSL ("the server binds 127.0.0.1, a remote client cannot reach it")

**Verdict: `app side`.** The bind is confirmed and should stay loopback. An SSH local forward already
solves the reachability with no crust change; a LAN-bind config key and a crust client mode should
both be refused, for different reasons.

### Evidence

- Bind: `src/bridge/server.ts:72-78`, `HOST = "127.0.0.1"` (`src/bridge/server/cors.ts:16`),
  documented as the security boundary at `site/app/docs/limits/page.mdx:57`.
- The page's transport is HTTP to a base URL (`src/bridge/client/invoke.ts:126-139`) plus an event
  stream; the darwin realm opens the same stream itself (`content-world-source.ts:35-36,51`).
- No transport abstraction exists: `Platform` is five methods and has no connection member
  (`src/app-types.ts:27-51`), and `startBridge` only ever calls `Bun.serve` (`server.ts:72`).

### Option 1 — SSH local forward (no crust change): **correct**

`ssh -N -L 45000:127.0.0.1:45000 user@host` puts the app's loopback port on the remote loopback, and
a client there calls it exactly as the doctor does (`src/cli/doctor/bridge.ts:72-83`). Costs: it
needs an SSH identity on the machine, which already grants more than this token does; anything
running as that remote user can use the forwarded port; the token is encrypted in transit but lands
in a remote shell history if pasted. It is the same trust boundary the app already has — the OS
account — extended by one authenticated hop, which is why it needs no code.

### Option 2 — a config key to bind a LAN interface: **do not do this**

What it would take: turn `HOST` into a config value, then fix `ownOrigins`
(`src/bridge/server/cors.ts:25-27`) so the bound address is same-origin while `localhost` and
`127.0.0.1` stay allowed, since a local window would otherwise be refused by `allowedOrigin`
(`cors.ts:40-50`). `Bun.serve` takes one hostname, so "one LAN interface" really means `0.0.0.0`,
which also opens every other interface the machine has. The security cost is decisive: cleartext
HTTP, no TLS, no client identity, no per-peer scoping, no rate limit, and the token is the only
credential — now sniffable on the network. ATS would let the page load
(`src/packaging/plist.ts:22-24`), but nothing in the invoke path is authenticated beyond a UUID, and
the whole IPC surface sits behind it (`capabilities.ts:8-14,44-48`). It also makes the documented
"loopback is the boundary" false (`limits/page.mdx:57`). A tunnel gives the same reach with an
authenticated peer and zero new attack surface in crust.

### Option 3 — outbound connection instead of a listener (client mode): **no seam, and no**

`Platform` (`src/app-types.ts:27-51`) has no transport, `startBridge` is a `Bun.serve` only
(`server.ts:72`), and both clients assume a base URL they can `fetch` and an `EventSource` they can
open (`src/bridge/client/invoke.ts:126-139`). A client mode means a transport abstraction on both
ends and inverting the model — the bridge exists to serve the app's own page, which is what the
document route and CSP are built around (`handler.ts:71-105`, `csp.ts:14-23`). An app that needs to
dial out does not need crust to do it: its backend is an ordinary Bun process, so a plugin can run
its own listener, or the app can ship a binary through `build.sidecars`
(`src/config/types.ts:66-71`) and speak whatever protocol the remote side expects — with its own
authentication, which crust must not pretend to provide.

### What it would take (crust's honest share)

Nothing in the runtime. One docs page under `site/app/docs/guides/` stating the forward command, that
the token must be copied through the tunnel or a clipboard rather than a shell echo, and that a
paired client talks crust IPC — plus one line on the limits page that the forward is the supported
way to reach the bridge from elsewhere. If the app's real need is a product API, say plainly that
crust's port cannot serve one (`handler.ts:195`), so the tunnel must point at the app's own listener.

### What breaks

- Adding a LAN bind would turn an IPC bus into a network service with a UUID as its only lock.
- Documenting a tunnel to the bridge as if it were a product API sends people to a `404`, because
  only assets, the document and `/_crust/*` are routed (`handler.ts:28-29,111-146,195`).

### Estimate

**S** for the documentation-only share; **M** for the LAN config (and rejected); **L** for a client
mode (and rejected).

### What stays the app's job

Choosing the transport and whether the remote side talks the bridge or the app's own API, the
protocol and authentication of that API, the client-side pairing UX, and the SSH setup itself.

### Largest risks, side by side

- **#6:** a credential shown on screen and copied to a clipboard can leak a label's whole grant set;
  mint a document token, scope the label, and make revoke part of the same surface.
- **#7:** a LAN bind with no TLS would put the fs/shell/clipboard surface on the network behind one
  sniffable UUID, and would silently retire the documented loopback boundary.
