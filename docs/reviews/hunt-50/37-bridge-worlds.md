# hunt-50 · bridge worlds and the page console tap (37)

Read-only hunt. Scope: `src/bridge/page-console.ts` and the darwin content-world sources
(`src/platform/darwin/content-world-source.ts`, `content-world.ts`, `shim/121_content_world.c`),
traced into the two page-world consumers (`src/plugins/testing-script.ts`,
`testing-observe.ts`, `src/bridge/client/invoke.ts`) to establish reachability. Discovery and
tracing used `rg`/`fd` only; no source was changed, no gate or probe run.

**Count: 5 findings (0 high, 2 medium, 3 low).** The credential itself stays out of the page
world in every path I could reach: the isolated script scrubs `?token=` at document start, the
served HTML never serialises the token, and `installCrust` drops it from `crust`/`__CRUST__` when
`crustInvoke` exists. What is weaker is the *boundary*: the two halves talk over a public,
forgeable DOM event bus, and the new console observability channel lives wholly in the untrusted
world. No overlap intended with hunt-50/23 (partial install, `scriptsOn`, malformed `crust:req`,
fetch timeout) or /35 (invoke-half latches).

**Worst: F1 — the shared DOM event bus lets page-world script impersonate the isolated world's
answers. The page cannot read the token, but it can forge the `crust:res`/`crust:evt` frames the
app trusts, using a predictable request id.**

---

## F1 (medium, worst) — forged `crust:res` / `crust:evt` on the shared document

- `src/platform/darwin/content-world-source.ts:43-46,69` — the isolated half publishes `crust:evt`
  and `crust:res` as `CustomEvent`s on the same `document` the page world can dispatch on.
- `src/platform/darwin/content-world-source.ts:140-147` — the page half accepts any `crust:res`,
  parses `detail`, and settles `waiting[reply.id]` with no check that the frame came from the
  isolated world.
- `src/platform/darwin/content-world-source.ts:150` — ids are `"crust-" + ++seq`, a predictable
  counter, not a secret.
- `src/bridge/client/invoke.ts:104-115` — the client's `crust:evt` listener likewise trusts
  `frame.event`/`frame.data` from a public DOM event and calls `onEvent` with it.
- `src/platform/darwin/content-world-source.ts:129-130` — the comment claims "replacing this
  function buys nothing, because the world that owns the credential is not reached by the page."

**Reached:** any script executing in the page world (app code, a third-party dependency, an
injected extension). It adds a `crust:req` listener to `document`, learns the next id from a real
`crustInvoke` call, then dispatches a `CustomEvent("crust:res", { detail: JSON.stringify({
id: "crust-N", ok: true, result: … }) })` before the isolated world's real response. The client
settles with the forged payload and deletes the waiter; the genuine reply arrives to no waiter and
is discarded. The same script can dispatch `crust:evt` to inject arbitrary frames into
`crust.listen`/`crust.once`. The token is never exposed, so this is not a credential escape — but
it *is* transport impersonation: code that gates behaviour on `await crust.invoke(...)` can be
fed an attacker-chosen result, which the comment above says is impossible. DOM strings are the
only channel, and there is no nonce or world-origin tag on these frames to tell the two worlds
apart.

---

## F2 (medium) — `testing.console` reads a store owned entirely by the page world

- `src/bridge/page-console.ts:20-24` — the tap keeps entries in `window.__crustConsole`, a plain
  page-world global; `Array.isArray(store)` is its only install guard.
- `src/bridge/page-console.ts:43` — every entry is written by page-world code.
- `src/plugins/testing-script.ts:175-183` — the readback evaluates `window.__crustConsole` in the
  page world and returns `{ hooked: true, entries }` verbatim.
- `src/plugins/testing-observe.ts:64-82` — `testing.console` forwards those entries as ground
  truth (only `hooked === false` is turned into `not-implemented`).

**Reached:** a page that sets `window.__crustConsole = []` before the document-start user script
runs (or reassigns/pushes to it later) makes the tap's `Array.isArray` guard return early — no
capture — or feeds the host fabricated entries that are answered as if the bridge recorded them.
The host's evaluation channel runs in the page world, so it reads exactly the array page script
controls. The tap's own header claim (`page-console.ts:6-8`) that it "touches nothing the
credential lives in" is true, but the inverse is not asserted: the observability channel is not
isolated from the world it observes, so `testing.console` is a claim about what the page *says*
it logged, not a verified transcript.

---

## F3 (low) — page-controlled `crust:sub` grows the isolated world's listener set without bound

- `src/platform/darwin/content-world-source.ts:55-64` — `crust:sub` detail is parsed and every
  name is passed to `relay()` with no cap or membership check.
- `src/platform/darwin/content-world-source.ts:38-47` — `relay()` adds one EventSource listener
  per distinct name and records it in `relaying` permanently.

**Reached:** page-world script dispatches `crust:sub` with a JSON array of thousands of unique
names. The isolated world opens the token-bearing EventSource (one stream, guarded at `:48-54`)
and installs a listener for each name, growing the isolated world's heap and per-frame work from
the untrusted world. No token crosses back, but a page can degrade the credential-holding world
through the event channel — the one surface the two worlds share.

---

## F4 (low) — a logging object with throwing `toJSON` and `toString` breaks the patched console method

- `src/bridge/page-console.ts:26-34` — `text()` catches a throw from `JSON.stringify` but calls
  `String(value)` inside that catch with no second guard.
- `src/bridge/page-console.ts:40-46` — the patched method calls `text()` before
  `original.apply(console, arguments)`.

**Reached:** page code logs an object whose `toJSON` throws and whose `toString`/`valueOf` also
throws (a hostile proxy or a deliberately crafted object). The first throw is caught, the
unguarded `String(value)` in the catch throws again, the wrapper aborts, and the original
`console.log` is never called — the page's own diagnostic output is lost. This is a page-world
correctness bug in the tap, not a cross-world escape; it is listed because it is in the
question's primary file.

---

## F5 (low) — the console tap exists only on the content-world path

- `src/platform/darwin/content-world.ts:63-85` — install is gated on `?token=` in the URL and on
  `WKContentWorld`; no script (and so no `PAGE_CONSOLE_SOURCE`) is injected otherwise.
- `src/bridge/page-console.ts:1-12` — the tap has no other injection point.
- `src/plugins/testing-observe.ts:74-79` — `testing.console` answers `not-implemented` with
  `requires: "PAGE_CONSOLE_SOURCE at document start"` when the tap is absent.

**Reached:** a `crust dev` Vite page (no `?token=`), or any Linux/Windows window, has no console
tap, so `testing.console` can never return entries there. The error names a source constant but
the app has no supported way to install it on those platforms — the observability feature is
silently darwin-and-token-only. A documentation gap functionally rather than a credential
issue, but it means the "page console" surface is not portable across the worlds crust supports.

---

## Coverage / not done

Read `page-console.ts`, both darwin content-world source modules, `content-world.test.ts`,
`client/content-world.test.ts`, `testing-console.test.ts`, and followed every exported symbol into
`install.ts`, `invoke.ts`, `testing-script.ts`, `testing-observe.ts`, `testing-run.ts`,
`testing-fake.ts`, `bootstrap.ts`, `handler.ts` and `assets.ts` with `rg`. Confirmed sound: the
token is scrubbed from the shared URL before page script runs; the served HTML carries no token;
`crust`/`__CRUST__` drop it on the realm path; the console tap contains no token, fetch or
authorization string; the C shim resolves a real `WKContentWorld` and never passes a nil world to
the initializer. No source modified; no tests, gate, GUI probe or focus-affecting action run.
