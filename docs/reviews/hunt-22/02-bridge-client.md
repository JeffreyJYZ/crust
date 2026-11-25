# Hunt 22 — `src/bridge/client/**`

Field: the injected page client — bootstrap serialisation, install/ready, invoke transport both worlds, event dispatch, page-local a11y, and their tests. Findings below were re-derived from this tree; hunt-20/hunt-21 items already fixed are not repeated.

## MEDIUM — `crust.ready` rejects on a typed command failure, not just a bridge refusal

- where: `src/bridge/client/invoke.ts:150-151`, `src/bridge/client/install.ts:55-69`, `src/bridge/server/invoke-request.ts:79`, `src/bridge/server/failure-status.ts:35-41`
- mechanism: A command that returns `{ ok: false, code }` is a normal result, but `resultStatus` gives the HTTP response a 4xx while the envelope stays `{ ok: true, result: … }`. The invoke half calls `onAnswer(status)` straight from `response.status`, so `markHandshake` reads the 4xx as a bridge refusal and rejects `ready` with `code: "bridge-refused"`. The invoke itself resolves with the typed value, and `handshaken` latches, so no later 2xx call repairs `ready`.
- reachable by: `measured`. Started a loopback bridge with a plugin returning `{ ok: false, code: "invalid-label", message: "bad label" }`, installed the client with `stream: false` (no SSE ready frame), invoked once. The invoke resolved with the typed failure; `await api.ready` rejected `{"name":"CrustInvokeError","code":"bridge-refused","status":400,"message":"crust: bridge refused (400)"}`. Also reachable with a stream when an app's first invoke beats the `crust:ready` frame. `site/public/SKILL.md:197-206` states both behaviours — "4xx rejects ready" and "a typed failure resolves with a 4xx/5xx transport" — so the two contracts collide.
- smallest fix: Decide handshake from the envelope, not the HTTP status: a parsed body with `ok === true` (or a handler-error body) proves reachability; reject only when `body.ok === false` and the status is 4xx. Alternatively keep typed failures at HTTP 200 and let callers inspect `result.ok`.

## MEDIUM — `once()` registered inside a listener for the same event resolves with the event that triggered it

- where: `src/bridge/client/install.ts:82-100` (`dispatch`), `src/bridge/client/install.ts:136-159` (`once`)
- mechanism: `dispatch` runs all current listeners first, then looks up `waiters.get(event)` and resolves every entry with the current payload. A listener that calls `once(event)` during that dispatch appends its `settle` to the waiter array before the lookup, so the fresh waiter is settled with the same event it was meant to wait past.
- reachable by: `measured`. Injected `bootstrapSource` into the real fixture, registered `api.listen("tick", () => api.once("tick").then(...))`, dispatched one `tick` with payload `1`. Observed `[["listen",1],["once",1]]` — the re-armed one-shot consumed the triggering event. A re-arm-on-each-event pattern processes one event twice.
- smallest fix: Snapshot and drain the waiter array before invoking listeners, or stamp each waiter with the dispatch generation and skip waiters registered during the current dispatch.

## MEDIUM — malformed selectors throw a raw `DOMException` out of `crust.a11y` instead of a refusal

- where: `src/bridge/client/a11y-page.ts:115-123` (`pageTree`), `src/bridge/client/a11y-page.ts:145-156` (`focusElement`)
- mechanism: Both commands call `d.querySelector(selector)` outside any `try`. Native `querySelector` throws `SyntaxError` for an invalid CSS selector, so execution never reaches the `not-found` or `bad-request` branches. The answer type has a `bad-request` code but no path uses it for a selector the browser refuses to parse.
- reachable by: `measured` with the injected source against a document stub whose `querySelector` throws `DOMException("Invalid selector", "SyntaxError")`; both `pageTree("[")` and `focusElement("[")` threw instead of returning `{ ok: false }`. Real browsers throw on malformed selectors. `site/app/docs/guides/accessibility/page.mdx:105` promises unmatched or empty selectors answer `not-found` or `bad-request`. The fake DOM at `a11y-page-fake.ts:97-116` is a substring matcher that never throws, which is why the suite does not catch this.
- smallest fix: Wrap each `querySelector` call in a `try` and return `{ ok: false, code: "bad-request", message: "… <selector>: <reason>" }`, keeping `not-found` for a valid selector with no match.

## LOW — the `installPage` fixture always injects a token into the bootstrap config, so the served page's token-from-URL path is never exercised end to end

- where: `src/bridge/client/fixtures.ts:84-99`, `src/bridge/client/bootstrap.ts:35-37,68`, `src/bridge/server/assets.ts:118-122`
- mechanism: `installPage` sets `config.token = bridge.token` for the served source. `bootstrapSource` serialises that token into the inline script, and `Object.assign({ window: PAGE_WINDOW, token: PAGE_TOKEN }, config)` puts config last, so `PAGE_TOKEN` is always overridden in tests. Production `documentResponse` deliberately passes no token and relies on `PAGE_TOKEN`.
- reachable by: `read`. Deleting or breaking `PAGE_TOKEN` leaves `client.test.ts` and `client-guards.test.ts` green; only the string assertions in `document-token.test.ts:89-92` notice. The main invoke/ready/event proofs therefore run against a state a served page never has.
- smallest fix: Build the served fixture from a tokenless config (`{ baseUrl, port, window? }`) and let `location.search` supply the token, matching `documentResponse`.

## LOW — the hostile-window-label document test is still vacuous

- where: `src/bridge/client-guards.test.ts:48-58`
- mechanism: The test fetches `${bridge.url}/?window=${encodeURIComponent(label)}` with no `?token=`. The document route requires the token first, so it answers 401 and `documentResponse` never runs; the assertion that the HTML lacks an injected `<script>` passes against a JSON error body. hunt-20 reported this and it remains open.
- reachable by: `measured` — the same URL shape against a fresh loopback bridge returned HTTP 401.
- smallest fix: Append `&token=${bridge.token}`, follow the redirect, and assert the served HTML contains no raw `</script><script>` sequence.

## LOW — a content-world `no-fetch` resolves `crust.ready` although the bridge is unreachable

- where: `src/bridge/client/invoke.ts:120-127`, `src/platform/darwin/content-world-source.ts:113-118`
- mechanism: The isolated world answers transport failures with `error.status: 0`. The invoke half computes `(reply?.error?.status as number) || 500`, so `onAnswer(500)` resolves `ready` under the "5xx means reachable" rule, while `fail(reply?.error, 0)` throws an error whose status is 0. The fetch path treats a transport throw as pending, so the two transports disagree about readiness.
- reachable by: `measured`. Installed `installCrust` with a `crustInvoke` stub returning the exact `no-fetch` envelope; the invoke rejected with `{"code":"no-fetch","status":0}` and `await api.ready` resolved.
- smallest fix: Treat status 0 as a transport failure on the realm path — leave `ready` pending or reject with that same error — and pass the computed status into `fail()` so both paths report one status.

## LOW — event subscriptions are never torn down at the transport

- where: `src/bridge/client/install.ts:121-131`, `src/bridge/client/invoke.ts:163-176`
- mechanism: `listen`'s unsubscribe removes only the local `Set` entry. `asked` keeps the event name forever and `InvokeHalf` has no detach path; on darwin the isolated world's `relay` map keeps one stream listener per name for the page's life. The set is bounded by distinct event names, so this is retained work, not unbounded growth.
- reachable by: `read` of `listen` and `half.attach`; no test unsubscribes and then checks the transport.
- smallest fix: Return a detach from `attach` or add `detach(event)` to `InvokeHalf`; call it when the last local listener leaves, removing the EventSource listener and telling the content world to drop its relay.

## Checked and clean

- **Bootstrap escaping** (`bootstrap.ts:47-53`, `client-guards.test.ts:36-46`): `read`. `<`, `>`, U+2028 and U+2029 are escaped; a `</script>` label cannot close the inline element. The end-to-end half is the vacuous test above.
- **Byte tagging and prototype safety** (`invoke.ts:52-85`, `server/bytes.ts:30-68`): `read` plus `client-guards.test.ts:116-142`. `Object.defineProperty` keeps `__proto__` as an own field, `__crustLiteral` walked one level down, and depth 1 matches the server walker. No new defect found.
- **Real 4xx refusal** (`client.test.ts:94-106`): `read`. A wrong token rejects `ready` with 401 and the bridge's reason, as documented; the typed-failure finding above is the case the status-only rule mishandles.
- **`once` timeout** (`install.ts:135-159`, `client.test.ts:137-151`): `read`. The waiter is removed on settle and on timeout, and a late event does not consume a new waiter. The re-entrancy bug is a separate path.
- **Token scrubbing on darwin** (`install.ts:182-197`, `content-world.test.ts:124-162`): `read` plus tests. With `crustInvoke` present, neither `api.token` nor `window.__CRUST__.token` carries the credential, including when `replaceState` refuses to scrub the URL.
- **`focusable` semantics** (`a11y-page.ts:86-101`, `site/app/docs/guides/accessibility/page.mdx:103`): `read`. The docs define `focusable` as tab reachability, so `tabindex="-1"` reporting `false` is intended and is not reported.
- **No source was edited, no gate or build run, no GUI touched.** The `measured` claims came from short Bun scripts under the approved temp dir: three used the real injected source (one with a loopback bridge) and one probed the document route; every bridge was stopped before the script exited.
