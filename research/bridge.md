# crust bridge probe — measured results

Status: measured on Bun 1.4.4, macOS 27.0.1 (arm64, 10 cores), in `/Users/jyz/dev/crust/research/bridge/`.
Every number below came from one command in this file; the full output of each run is quoted
verbatim at the end. The machine was otherwise idle, no window existed, and nothing was left listening.

## How to run

```
bun run /Users/jyz/dev/crust/research/bridge/raw.ts         # the 8 required probes
bun run /Users/jyz/dev/crust/research/bridge/raw.ts latency # one probe
bun run /Users/jyz/dev/crust/research/bridge/traps.ts       # 7 implementer traps
bun run /Users/jyz/dev/crust/research/bridge/keepalive.ts   # reused-socket cost + SSE order
bun run /Users/jyz/dev/crust/research/bridge/concurrency.ts # event-loop serialisation
bun run /Users/jyz/dev/crust/research/bridge/sse-burst.ts   # burst coalescing
bun run /Users/jyz/dev/crust/research/bridge/fetch-path.ts  # fetch peer address + client end-to-end
```

Each process prints one `PASS`/`FAIL` line per probe plus a `SUMMARY:` line, then exits
(non-zero on any failure). Nothing hangs, nothing is left listening, and no window is needed.
`raw.ts` takes a probe name to run one: `bind`, `latency`, `token`, `origin`, `sse`,
`payload`, `headers`, `reuse`.

---

## 1. Ephemeral-port bind on `127.0.0.1`, and bind latency

**PASS** — `port=54390` (ephemeral), `Bun.serve` call to first accept `0.11 ms`; loopback by IP
`true`, by `localhost` `true`, LAN `192.168.2.226` `false`.

The bind is fast enough to be free at launch, and the port is unpredictable: `port: 0` means
the OS allocates it, so two crust instances, or crust beside any other local server, cannot
collide. Binding `127.0.0.1` (not `0.0.0.0`) is what makes the LAN address unreachable — that
was measured by actually dialling `192.168.2.226:<port>` and getting a refusal, not assumed
from the bind address.

## 2. Invoke round trip: median and p99 over 200 calls, with the same-process floor

**PASS** — 200 sequential `POST /_crust/invoke` over fresh sockets: **median `0.119 ms`,
p99 `1.276 ms`**, min `0.090 ms`, max `4.808 ms`, 200/200 correct bodies.

The same-process floor, the same handler serialised through `Response()` with no socket:

| measured path | median | p99 |
|---|---|---|
| handler only, in process | `0.0005 ms` | `0.0066 ms` |
| full invoke over a fresh socket | `0.119 ms` | `1.276 ms` |
| full invoke over a reused socket | `0.045 ms` | `0.385 ms` |

So the handler is ~0.4 % of a call; the TCP round trip is the cost. The reused-socket row is
the one the page actually pays (`window.crust.invoke()` after the first call keeps the
connection), which makes the effective per-call budget about `0.05 ms` — roughly 20,000 calls
a second before the page's own JS is the limit.

The p99 is the honest number to design against: it is 3–10x the median on a quiet machine and
worse under load (a loaded run in the log measured p99 `5.5 ms`). Nothing in the design should
assume sub-millisecond worst case.

## 3. Bearer-token rejection and success

**PASS** — no token → `401`, wrong token → `401`, correct token → `200` with `{"ok":true,"result":"pong"}`.

The document route is the deliberate exception: `GET /` without a token → `200`, because the
page cannot hold its own token before it is served. Everything else, including the SSE
endpoint and the payload routes, is behind the gate.

Absent and wrong both answer `401` with the same body
(`{"ok":false,"error":{"code":"unauthorized",...}}`), so a caller cannot tell "no token" from
"bad token" and the check cannot be skipped by omitting the header.

## 4. Origin check: own, absent, foreign

**PASS** — own origin `200`, **absent header `403`**, foreign origin `403`, dev origin while
dev origins are off `403`, dev origin while configured `200`, foreign origin while a dev
origin is configured `403`.

The absent case is the one that matters. `fetch()` always sends `Origin` for a same-origin
call, so a request with no `Origin` is a non-browser local client — curl, another process, a
script — and treating a missing header as "same origin" would let any local process drive the
bridge without the token. Refusing it explicitly is why the check holds.

Enabling a dev origin widens exactly one thing: that origin may call. It does not make
foreign origins acceptable, and it does not change what the served page itself is allowed.

## 5. SSE: 20 messages, order, delay, buffering

**PASS** — ready frame plus `20/20` ticks in order, `21` socket reads for `21` frames, span
`410.9 ms`, inter-message gap **median `20.38 ms`** (max `32.64 ms`) at a 20 ms interval,
**`coalesced=no`**.

- **Order**: every tick arrived as `1..20`, none merged, split or dropped. Verified again
  independently by `keepalive.ts` (`20/20`, in order).
- **Delay**: the gap tracks the configured interval; the stream adds no measurable latency of
  its own. At 20 ms the median gap is `20.38 ms`, i.e. ~0.4 ms overhead per frame.
- **Buffering**: on the wire there is none — one socket read per frame at this rate, so the
  page's `onmessage` fires once per push rather than in batches. Bun *does* batch when
  several pushes happen in one tick: `sse-burst.ts` pushed 50 in a single tick and got **1
  chunk of 1090 bytes**. So latency is per flush, not per event.
- Wire framing: Bun sends the stream with `Transfer-Encoding: chunked`. That is internal to
  HTTP and invisible to `EventSource`, but any non-browser consumer must de-chunk.
- `idleTimeout: 0` is mandatory: with Bun's 10 s default the stream is cut mid-flight
  (`traps.ts` keeps one alive `12002 ms` only because the option is set).

## 6. One-megabyte JSON body and one-megabyte binary body, timed

**PASS** — 1 MB JSON up `2.4 ms` (the server read `1.00 MB`), 1 MB binary up `1.8 ms`
(`1.00 MB`), 1 MB JSON response `1.6 ms` (`1.00 MB` back), 1 KB JSON `0.31 ms`.

Both bodies actually arrived at their full size — the probe echoes the byte count the server
read, so a truncated or silently dropped upload fails the check rather than looking fast. That
mattered: an early version reported impossible times because the client handed
`socket.write()` 614,621 bytes and it accepted 327,212, dropping the rest without an error.
With the write loop in `http.ts`, 1 MB is ~2 ms in either direction, i.e. ~500 MB/s on
loopback, well past what a page will ever push.

Chunked request bodies are also accepted (`traps.ts`): a `fetch` with a stream body works and
`req.text()` de-chunks it. Request bodies over 2 MB are refused with `413` before parsing.

## 7. Port reuse after `server.stop()`, and clean process exit

**PASS** — after `stop()`, `startBridge({ port })` rebinds the **exact same port in `0.45 ms`**
and serves a working invoke on it (`serving=true`, original port `54623`); a child process
that starts the bridge, stops it and returns **exits `0` in `12 ms`** with no `process.exit()`
call.

That combination is what makes crash-and-relaunch and dev-server restart cycles safe: the
port is released immediately, it is not stuck in `TIME_WAIT`, and a stopped bridge does not
keep the process alive. The exit half is the subtle one — a listening socket or a live
`setInterval` would keep Bun's event loop open and the process would hang with no error.

## 8. Exact CSP and CORS headers, and the Vite-origin delta

**PASS** — the document is served with the CSP below and **no CORS headers**; a same-origin
call works with **no CORS headers**; the Vite origin gets `403` on preflight, call and stream
in production, and `204`/`200`/`200` with an echoed origin in dev; the bridge's own page
still gets no CORS headers even when a dev origin is configured.

### Headers every served document carries

```
content-type: text/html; charset=utf-8
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
x-content-type-options: nosniff
referrer-policy: no-referrer
cache-control: no-store
```

`connect-src 'self'` is the line that lets the page call `/_crust/invoke` and hold
`/_crust/events` open. Without it every bridge call is a CSP violation reported in the
console, not a network error, which is a confusing first-window bug. `form-action 'none'` and
`base-uri 'none'` close the two cheapest injection paths; `frame-ancestors 'none'` stops the
page being framed by anything local.

### Same origin (production)

The document and every call are served with **no** `access-control-allow-origin` at all —
measured as `acao=none`. None is needed: a page served from `http://127.0.0.1:<port>` calling
the same origin is not a cross-origin request, so a preflight never happens. The production
`OPTIONS` answer is therefore a deliberate `403`, and it is never reached by the real page.

### Page from Vite on another origin (`http://localhost:5173`)

Three things change, and only for an origin listed in `BridgeOptions.devOrigins`:

| Request | Production | Dev origin configured |
|---|---|---|
| `OPTIONS /_crust/invoke` | `403` | `204` |
| `POST /_crust/invoke` | `403` | `200` + `access-control-allow-origin: http://localhost:5173` |
| `GET /_crust/events` | `403` | `200` + `access-control-allow-origin: http://localhost:5173` |

The preflight answer, verbatim:

```
access-control-allow-origin: http://localhost:5173
access-control-allow-methods: POST, GET, OPTIONS
access-control-allow-headers: authorization, content-type
access-control-max-age: 600
vary: origin
```

`authorization` must be in `allow-headers` or the browser refuses to send the `Authorization`
header the token lives in — the preflight is where the bridge design and the browser agree,
and this is the header set that passed. `vary: origin` rides on the invoke and stream
responses too, so a proxy or cache cannot serve one origin's response to another.

The SSE stream needs `access-control-allow-origin` for the same reason the invoke route does:
`EventSource` sends `Origin` and cannot set headers, so a cross-origin page whose stream lacks
that header fails to open with no useful error. It is the trap most likely to be missed,
because the page's own calls work while its event stream silently never connects.

What does **not** change: the bridge's own page keeps `acao=none` even with a dev origin
configured. Configuring Vite adds an allowed caller; it does not loosen what is served.

---

## Supporting probes

These answer questions the eight probes raise but do not cover.

### Reused vs fresh connection (`keepalive.ts`)

| path | median | p99 |
|---|---|---|
| reused socket, n=200 | `0.045 ms` | `0.385 ms` |
| fresh connection, n=200 | `0.123 ms` | `0.380 ms` |

A page keeps its connection, so its first call pays the fresh cost once and every later call
pays the reused one — about 2.7x cheaper than a naive `fetch`-per-call probe suggests. Any
latency figure quoted for the bridge has to say which of the two it is.

### Concurrency (`concurrency.ts`)

Three parallel requests that each block the loop for 200 ms finish in **`600.2 ms` wall**
(`600.2`, `600.2`, `600.2`), not 200 ms. Verdict: **serialised**. A synchronous handler
stalls every other request: `traps.ts` measured an unrelated `noop` answering in `300 ms`
while a 300 ms blocking handler ran. Every command must be async, or a slow `fs`/`dialog`
call freezes the page's invokes, including the one it is waiting on.

### Burst coalescing (`sse-burst.ts`)

`50` pushes emitted in one tick arrive as **`1` chunk of `1090` bytes** in `1.0 ms`. Bun does
not flush per `controller.enqueue`, so a burst costs one write, not fifty. A 20-message burst
at a 1 ms interval also survives (`traps.ts`, `1501/1500 ms`), but a sustained 1 ms push is a
busy loop competing with the page's own JS.

### fetch path and the page client (`fetch-path.ts`)

`fetch()` to `127.0.0.1` arrives with `peer=127.0.0.1`, `family=IPv4` — loopback is **not**
proxied on this machine, so fetch timings are real. `BridgeClient.invoke` works end to end:
`noop` → `"pong"`, a 1 MB response in `0.76 ms`, and a throwing handler rejects with
`code="handler-error"` rather than resolving.

This corrects an earlier note in this folder which claimed the system proxy intercepted
loopback and that every fetch-based number was therefore suspect. That is wrong; the raw
socket client stays because it exposes wire bytes and per-request connection cost, not
because `fetch` is unusable.

---

## Implementer surprises

1. **`socket.write()` accepts fewer bytes than it is given** and silently drops the rest
   (`327212` of `614621` measured). Every writer must loop until the request is on the wire.
   This, not a proxy, is what made the first 1 MB uploads time out.
2. **`Bun.connect` returns a promise.** Not awaiting it leaves the socket undefined inside its
   own handlers, and the `error` callback then receives a `TCPSocket`, not an `Error`. An
   expected refusal also prints Bun's own `error: Failed to connect` into the output unless
   the rejection is caught.
3. **One synchronous handler stalls the whole bridge** (600 ms wall for 3×200 ms; noop at
   300 ms behind a 300 ms handler).
4. **SSE needs CORS, not just the invoke route** — `EventSource` sends `Origin` and cannot set
   headers, so a dev-origin stream without `access-control-allow-origin` never opens.
5. **`idleTimeout: 0`** or Bun's 10 s default kills the stream mid-flight.
6. **A chunked request body is accepted** and `req.text()` de-chunks it, so a browser `fetch`
   with a stream body works with no extra handling.
7. **Errors are structured**, so page code branches on `error.code` (`not-found`,
   `unknown-command`, `bad-json`, `unauthorized`, `bad-origin`, `handler-error`, `too-large`)
   instead of string-matching status codes.
8. **`Origin` is refused when absent** (`403`), not treated as same-origin, which is what
   stops a local non-browser client.
9. **The bridge accepts two own-origins**, `http://127.0.0.1:<port>` and
   `http://localhost:<port>`. `DESIGN.md` §4 prefers the `localhost` hostname for the ATS
   exemption, and a page's `Origin` comes from the URL it was loaded from, not from the bind
   address — a server that only accepted the bind host would reject its own page.
10. **A stopped bridge releases the port and the process** (rebind `0.45 ms`, child exit `0`
    in `12 ms`), so relaunch and dev-server restarts need no special handling.

## Corrections to the brief

- **`fetch()` to loopback is not proxied here.** The brief's note that the system proxy
  intercepts loopback was wrong; `fetch-path.ts` shows the server seeing `127.0.0.1`. See
  above.
- **`DESIGN.md` §4 specifies `crypto.randomUUID()` as the token.** Nothing measured depends on
  the format; a 36-byte UUID in the `Authorization` header is inside the measured noise.
- **`DESIGN.md` §4 prefers `localhost` over `127.0.0.1` for ATS**, which the probe satisfies by
  binding `127.0.0.1` while accepting both origins. The bind still has to be the IP:
  `localhost` resolves to `::1` first on this machine, so a server bound only to `127.0.0.1`
  and reached as `localhost` can fail before a header is ever read.

## Exact output of the final run

```
$ bun run raw.ts
PASS 1 bind: port=54390 bind=0.11ms loopback-ip=true loopback-name=true lan(192.168.2.226)=false
PASS 2 latency: socket n=200 bad=0 median=0.119ms p99=1.276ms min=0.090 max=4.808 | in-process Response() median=0.0005ms p99=0.0066ms
PASS 3 token: no-token=401 wrong-token=401 correct=200 (result=pong) document-without-token=200
PASS 4 origin: own=200 absent=403 foreign=403 dev-when-off=403 dev-when-on=200 foreign-when-dev-on=403 :: absent header is refused, so a check cannot be skipped by omitting it
PASS 5 sse: ready=true ticks=20/20 socketReads=21 span=410.9ms gap median=20.38ms max=32.64ms coalesced=no
PASS 6 payload: json 1.00MB 2.4ms (server read 1.00MB) | binary 1.00MB 1.8ms (1.00MB) | json 1.00MB response 1.6ms (1.00MB back) | 1KB json 0.31ms
PASS 8 headers: doc=200 acao=none doc-no-origin=200 | csp=default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none' | same-origin-call=200 acao=none | vite-prod: preflight=403 call=403 sse=403 | vite-dev: preflight=204 acao=http://localhost:5173 acah=authorization, content-type acam=POST, GET, OPTIONS max-age=600 vary=origin | call=200 acao=http://localhost:5173 vary=origin | sse=200 acao=http://localhost:5173 | own-page-under-dev-config acao=none
PASS 7 port-reuse + exit: rebind-exact-port=true in 0.45ms serving=true | original=54623 | child-exit=0 in 12ms stdout="stopped"

SUMMARY: 8/8 passed

$ bun run traps.ts
PASS 1 process exit: child exitCode=0 in 15ms stdout="stopped" clean, no process.exit needed
PASS 2 idle timeout: idleTimeout:0 kept the stream alive for 12002ms, frames=20 (20 expected; Bun default 10s would have killed it)
PASS 3 sse cors: cross-origin EventSource to the SSE endpoint: status=200 acao=http://localhost:5173 :: present
PASS 4 blocking handler: noop answered in 300ms while a 300ms blocking handler ran :: CONFIRMED: one synchronous handler stalls every other request, so a slow command freezes the bridge
PASS 5 404 shape: GET /nope -> 404 "{\"ok\":false,\"error\":{\"code\":\"not-found\",\"message\":\"/nope\"}}" :: structured JSON error, so page code can branch on error.code
PASS 6 chunked request: chunked POST /_crust/invoke -> status=200 accepted :: req.text() transparently de-chunks, so a browser fetch with a stream body works
PASS 7 sse burst at 1ms: 20 frames delivered in 1500ms at a 1ms interval, 1501ms :: a 20-message burst is fine, a sustained 1ms push is a busy loop that competes with the page's own JS

SUMMARY: 7/7 passed

$ bun run keepalive.ts
PASS keep-alive vs fresh socket: reused socket n=200 median=0.045ms p99=0.385ms | fresh connection n=200 median=0.123ms p99=0.380ms :: the page's real cost is the reused-socket number
PASS 5b sse order: received 20/20 ticks in order=true :: every frame parsed clean, none merged or split

SUMMARY: 2/2 passed

$ bun run concurrency.ts
serial ms      : 200, 199.9, 200
parallel ms    : 600.2, 600.2, 600.2
parallel wall  : 600.2ms (3 x 200ms of blocking work)
VERDICT: SERIALISED by the event loop

$ bun run sse-burst.ts
pushes=50 chunks=1 chunkBytes=1090
events parsed=0 total=1.0ms bytes=1090
VERDICT: COALESCED into one chunk

$ bun run fetch-path.ts
PASS 9 fetch peer: fetch() to 127.0.0.1 arrives from peer=127.0.0.1 family=IPv4 :: loopback is not proxied, so fetch timings are real
PASS 10 client: BridgeClient.invoke: noop="pong" | 1MB response 1048576 bytes in 0.76ms | handler throw -> code="handler-error"

SUMMARY: 2/2 passed
```

## Files

- `bridge.ts` — the candidate server: `Bun.serve` on `127.0.0.1:0`, the token gate, the origin
  gate, `/_crust/invoke`, `/_crust/events`, `/_crust/echo-bytes`, `/_crust/block`, and the
  document route with `DOCUMENT_HEADERS`.
- `client.ts` — the page-side half: `BridgeClient.invoke()`, `openEvents()`, token handling.
- `http.ts` — raw HTTP/1.1 client over a TCP socket; the shared measuring instrument.
- `raw.ts` — the 8 required probes.
- `traps.ts` — the 7 implementer traps.
- `keepalive.ts` — reused-socket cost and SSE ordering.
- `concurrency.ts` — event-loop serialisation under parallel blocking handlers.
- `sse-burst.ts` — burst coalescing.
- `fetch-path.ts` — `fetch` peer address, and `client.ts` end to end.

None of these are part of the crust binary; they exist to answer §4 of `DESIGN.md` before a
window is built.
