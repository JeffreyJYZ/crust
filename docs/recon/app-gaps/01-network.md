# Gap 1 — voice, the network reachability half

Question: can a page in crust reach an external service at all today? Short answer: **yes, three ways**,
and one of them is a page `fetch` that an app already controls from config. The gap the app reported is
not a crust blocker.

## 1. Verdict

`app side`. A page in a built crust app can talk to a provider today by setting `security.csp` (an
existing config key that replaces the whole policy), and a page that will not touch CSP can relay
through an extension running in the Bun process, over the loopback bridge it already has. Two narrow
crust-side defects sit beside that, both costing less than a feature: a single-file app cannot set
`security.csp` at all, and the shipped `DEFAULT_CSP` has no `media-src`, so captured audio playback
through a `blob:` URL is refused by spec in a built app.

## 2. Evidence

### The page's origin is the loopback bridge, so `'self'` is never a provider

- `src/bridge/server/cors.ts:16` — `export const HOST = "127.0.0.1";`
- `src/bridge/server.ts:72-78` — `Bun.serve({ hostname: HOST, … })`, and `server.ts:85` returns
  `url: \`http://${HOST}:${port}\`` — the origin the document is served from.
- `src/app-windows.ts:42-43` — the window's URL is `bridge.url` plus the page path, plus
  `?window=` and `?token=`; no other origin is involved for a built app.
- `src/bridge/server/csp.ts:14-23` — `DEFAULT_CSP`, whose `connect-src 'self'` therefore means
  "the loopback bridge, port and all", never a provider.
- `src/bridge/server.ts:22-24` — the comment states the intent: "`connect-src 'self'` is the line
  that lets the page call the bridge and hold the event stream open; without it every invoke is a
  CSP violation in the console rather than a network error."

So yes: in a built app, `connect-src 'self'` blocks a cross-origin `fetch`, `WebSocket` and
`EventSource` to `wss://api.…` / `https://api.…`. Per CSP spec it likewise blocks a `sendBeacon`.
Nothing in crust narrows that further, and nothing widens it.

### `getUserMedia` and WebRTC need no CSP directive — only the mic opt-in crust already ships

- `src/bridge/server/csp.ts:14-23` — the whole policy. No `media-src`, no `camera-src` (not a
  directive), no `webrtc` directive. `getUserMedia` is a Permissions-policy/TCC decision, not a CSP
  one; there is no `Permissions-Policy` header anywhere (`rg -n "Permissions-Policy" src site` → no
  match, `src/bridge/server/http.ts:32-40` is the complete header set a document carries).
- `src/platform/darwin/shim/122_media_capture.c:1-11` — `getUserMedia` is live in every WKWebView;
  crust installs the `WKUIDelegate` that answers the request.
- `src/platform/darwin/shim/122_media_capture.c:81-83` — grant only when
  `media_grant && type == MEDIA_TYPE_MICROPHONE && media_bundled()`; camera and camera+mic deny.
- `src/platform/darwin/media-capture.ts:55-56` and `src/platform/darwin/platform.ts:36,109` — the
  `security.microphone` flag rides into every window's webview.
- `src/packaging/entitlements.ts:10-11,30-31` — `com.apple.security.device.audio-input` ships only
  when the app opted in.
- `src/config/types.ts:88-96` — the config comment, in full: purpose string, entitlement, and the
  grant; macOS only, Windows and Linux still deny.
- **Windows and Linux denial is code, not just prose**: `rg -n "Permission|permission"
  src/platform/windows/shim src/platform/linux/shim` returns **nothing**, so neither shim has a
  handler that could grant. That is the one platform gap inside this sub-question, and it is
  already documented (`site/app/docs/reference/config/page.mdx:123`, last sentence).
- `site/app/docs/reference/config/page.mdx:123` — "crust widens the grant and adds no recording API,
  so the stream, its tracks and where the bytes go are yours."

WebRTC peer connections need no CSP directive either, but they need a signalling channel, which is
the reachability question below, and `RTCPeerConnection` is not intercepted by the `crust-net`
`WKURLSchemeHandler` (`site/app/docs/guides/network/page.mdx:114` — only `crust-net://` requests reach
`decide`).

### The CSP is already app-configurable — this is the decisive finding

- `src/config/types.ts:82-84` — `SecurityConfig.csp?: string`, "Content-Security-Policy served with
  every document".
- `src/runtime.ts:115` — `csp: runConfig.security?.csp` is passed into `startBridge`.
- `src/bridge/server/types.ts:20-21` — "Override the policy. Defaults to `DEFAULT_CSP` plus the
  response's own script nonce."
- `src/bridge/server/assets.ts:138-141` — "An app's `security.csp` wins whole", then
  `headersFor(csp ?? defaultCsp(nonce))`.
- `src/bridge/server/csp-nonce.test.ts:98-105` — pins that behaviour: a configured
  `"default-src 'none'"` is the header, byte for byte.
- `src/config/validate-security.ts:148-154` — validation checks **one** thing: a `script-src` that
  omits `'unsafe-inline'` is refused because a custom policy cannot name the per-response nonce. It
  does not inspect `connect-src` at all; `validate-security.test.ts:107-117` shows arbitrary
  `connect-src` strings passing.
- So `connect-src 'self' https://api.example.com wss://api.example.com` is valid, today, with no
  code change. The key does not need to be invented; it exists and is documented
  (`site/app/docs/reference/config/page.mdx:114`).

Two caveats an app author hits, both already known:

- **A custom policy cannot carry the nonce**, so it must keep a `script-src` with `'unsafe-inline'`.
  Already filed: `docs/reviews/hunt-20/14-config.md:12-17`.
- **The config is compiled into a built binary** (`src/cli/build.ts:126` → `src/cli/build/wrapper.ts:47`,
  `await import(<absolute config path>)`, planned for `bun build --compile`), so changing `csp` in a
  shipped app is a rebuild, not a file edit. In `crust dev` the edit is live.
- **Dev and build differ**, which is how this gap reads as a crust bug to an app author: with
  `dev.url` set, the page is served by Vite and carries no crust CSP at all
  (`src/cli/dev.ts:87-95`, `src/app-windows.ts:35`), so an external `fetch` works in dev and breaks
  only in the built app. With no `dev.url`, dev serves the document from the bridge
  (`src/cli/dev.ts:88`) and the CSP applies there too.
- Even after the CSP opens, the provider's own CORS answer still governs whether the page can *read*
  the reply — the same story the docs record for `crust-net` at
  `site/app/docs/guides/network/page.mdx:86`.

### A proxy/relay seam already exists, and it is the better answer for audio

There is no HTTP proxy in crust, and that is deliberate: `site/app/docs/guides/network/page.mdx:3`
splits the `network` plugin into connectivity and `crust-net` interception, and `:114` says "a rule
list is not a proxy" — a page loading ordinary `https://` is never observed. But the relay an app
would otherwise build for itself is already the framework's extension seam:

- `src/plugins/define.ts:11-13` — `PluginContext.emit(event, data)`: "Push a server-sent event to
  every connected page."
- `src/plugins/define.ts:99` — `definePlugin`; `src/extensions/load.ts:2,44-49` — every `*.ts` under
  `extensions/` becomes a plugin; `src/runtime.ts:101-104` — those register beside the built-ins.
- An extension is an ordinary module in the Bun process, so it can `fetch`/`WebSocket` a provider with
  no CSP in the way at all: CSP governs the document, not the runtime.
- `src/bridge/client/types.ts:74-77` — the page half: `crust.listen(event, fn)` and `crust.once(event)`.
- `src/bridge/server/events.ts:37-46` — `sseFrame`, `data` is JSON so no line can be forged;
  `src/bridge/server/handler.ts:176-177` — the stream route, token-gated at `:160-174`.
- `site/app/docs/guides/extensions/page.mdx:94` — "a command from an embedded extension reaches the
  page"; `:113` — `ctx.emit` is how an extension pushes an event.
- Restrictable like any other command: `src/config/validate-security.ts:14` pins the
  `plugin:command` action shape, so `security.capabilities`/`grants` can fence an extension's network
  command per window.

So the relay is: page mic chunks → `window.crust.invoke("voice", "chunk", …)` → extension's provider
socket → `ctx.emit("voice:audio", …)` → page. It is a real seam and it needs zero crust change.

## 3. What it would take — the smallest honest design

Nothing for the direct path. For the two crust-side defects:

1. **`media-src` in `DEFAULT_CSP`** — one entry beside `img-src 'self' data:` in
   `src/bridge/server/csp.ts:14-23`, e.g. `media-src 'self' blob: data:`. Without it a captured
   stream played back from `URL.createObjectURL` is refused, because `media-src` falls back to
   `default-src 'self'` and `'self'` does not match `blob:`. Test lives next to
   `src/bridge/server/csp-nonce.test.ts`. **Label: spec-derived, not measured here** — this lane is
   read-only and ran no app; confirm with one built bundle before claiming it as a defect.
2. **A `security` path for single-file apps** — `src/single-detect.ts:101-112` builds the config with
   `app` and `windows` only, so a single-file app is locked to `DEFAULT_CSP` with no way to open
   `connect-src`. Smallest fix: add `security?: SecurityConfig` to the single-file input and carry it
   through `src/single-runner.ts` / `src/cli/build/wrapper.ts:105`'s `JSON.stringify(app.config)`.
3. **Docs, not code** — `site/lib/nav.ts` has no microphone or voice page, and the only prose is one
   paragraph at `site/app/docs/reference/config/page.mdx:123`. The two facts an app author needs are
   not written anywhere: that dev-with-Vite has no CSP and a built app does, and that
   `security.csp` is the key that opens `connect-src`. A `guides/microphone` page would carry both
   plus the relay shape — this is the cheapest item and the one that actually unblocks the report.

Explicitly **not** recommended: a crust-owned provider proxy. It would need per-provider auth,
streaming, and a policy surface, and it would put the app author's API key inside the framework.

## 4. What breaks

- `media-src blob:` widens what the page may play, not what it may run; the script door
  (`script-src` + nonce) is untouched. Cost: a captured stream could be exfiltrated through a media
  element's URL — but the page already holds the stream, so this adds no new authority.
- A single-file `security` key must not become a second config schema; it should reuse
  `validateSecurity` so a bad `microphone` sentence fails the same way in both paths.
- Opening `connect-src` is the app's decision and its security cost: the page's provider key becomes
  reachable by any injected script in that page. The nonce + `'unsafe-inline'` constraint
  (`docs/reviews/hunt-20/14-config.md:12-17`) is what makes `script-src` weak enough that this
  matters, which is the honest argument for the extension relay over direct `fetch` for anything
  holding a real key.
- Test shape: the `media-src` change touches `server-document.test.ts:30` /
  `csp-nonce.test.ts` expectations; the single-file change touches `single-detect.test.ts`. The
  200-line cap is not at risk in either (`csp.ts` is 50 lines).

## 5. Estimate

**S** — one line in `csp.ts`, one optional field in the single-file config path, and one docs page.
The reachability question itself needs no work; it is already answered by an existing config key.

## 6. What stays the app's job

- Which provider, its auth, its session protocol, and whether a realtime audio session exists at all.
- Chunking, resampling, barge-in and playback: crust hands over a `MediaStream` and, per
  `config/page.mdx:123`, deliberately adds no recording API.
- The provider's CORS behaviour if it chooses the direct path, and its key's exposure.
- Platform scope: macOS is the only capture platform today, and closing Windows/Linux is a
  separate gap with its own brief (WebView2 `PermissionRequested`, WebKitGTK `permission-request`
  — named at `site/app/docs/reference/config/page.mdx:123`, absent from both shims).
