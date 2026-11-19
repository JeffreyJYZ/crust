# Retries and partial failures — `src/bridge/client/`

Read-only hunt. Scope: all 13 files under `src/bridge/client/`. Traced the two transports
(fetch POST + EventSource in `invoke.ts`, DOM-event relay in the darwin content world) into
`src/platform/darwin/content-world-source.ts` and `src/bridge/server/events.ts` to establish
reachability. No source was changed, no gate run.

**Count: 6 findings** (0 high, 2 medium, 4 low/conditional). The client is well hardened: the
earlier "ready hangs on a failed invoke" and "`__proto__` / `__crustBytes` collision" findings are
fixed (`invoke.ts:144` marks handshake on any completed response; `invoke.ts:56-63` uses
`Object.defineProperty`). What remains is a family of one-shot latches and silent early returns
that leave a half-set-up client with no recovery path.

**Worst: F1 — `connect()` abandons the event stream with no retry and no error signal, so a
failed initial stream leaves `listen`/`once` permanently dead and `ready` hanging.**

---

## F1 (medium, worst) — the stream is opened once, on failure it is never retried and the page is never told

- `src/bridge/client/invoke.ts:180-181` — `if (typeof EventSourceImpl !== "function") return;` — no
  stream, no re-try, no error. `asked` already holds `crust:ready` (line 178).
- `src/bridge/client/invoke.ts:187-189` — `try { stream = new EventSourceImpl(...) } catch { return; }`
  — a constructor throw leaves `stream === null` and is swallowed.
- `src/bridge/client/invoke.ts:192` — `stream.onerror = () => {}` — an established stream that
  errors gives the page no signal; recovery relies entirely on the browser's own reconnect.
- `src/bridge/client/invoke.ts:170-174` — `bound()` returns when `!stream`, and `half.attach()`
  (`:160-162`) marks `asked[event] = true` before that. There is no later pass that re-binds a
  stream which did not exist at `connect()` time.

**Reached:** A page installs the client where `EventSource` is absent or whose constructor throws
(e.g. a webview that does not expose it, or a rejected scheme/URL). `installCrust` calls
`call.connect()` at `install.ts:159`; `connect` returns silently, `stream` stays `null`. Every later
`listen()`/`once()` calls `attach` → `bound` → early return, so no event is ever delivered, and
`crust:ready` never arrives from the stream. `ready` resolves only if some `invoke()` later
succeeds (`invoke.ts:144`); until then `await crust.ready` hangs. Once `scope.crust` is set the
double-install guard (`install.ts:24`) blocks re-installing with a working transport, so the only
recovery is a page reload — there is no in-client retry.

---

## F2 (medium) — `askWorld` latches `relayed = true` before the `crust:evt` listener is installed

- `src/bridge/client/invoke.ts:102-104` — `relayed = true` is executed *before*
  `doc?.addEventListener?.("crust:evt", …)`.
- `src/bridge/client/invoke.ts:99-101` — the only guard on installation is `relayed`; if
  `addEventListener` is missing the optional chain silently skips it.

**Reached:** On the darwin content-world path the page half subscribes only through `askWorld`.
If the first call runs against a `document` whose `addEventListener` is absent or throws, the flag
is already `true`. Every subsequent `askWorld` skips line 104 forever, so `crust:evt` frames —
including `crust:ready` — never reach the page: `listen`/`once` stay unresolved and `ready` hangs.
This is a partial-failure latching bug: the "installed" state is set before the install succeeds,
and no retry exists. Conditional on a stub/early document lacking `addEventListener`; a fully
booted browser always has it.

---

## F3 (low) — `scope.crust` is published before `connect()`, and the guard then blocks retry

- `src/bridge/client/install.ts:155` — `scope.crust = api;`
- `src/bridge/client/install.ts:159` — `call.connect();` runs *after* the api is published.
- `src/bridge/client/install.ts:24` — `if (scope.crust) return scope.crust` refuses a second install.

**Reached:** If `connect()` throws (the `hasRealm` branch calls `askWorld()`, whose
`new scope.CustomEvent(...)` at `invoke.ts:116` can throw for a hostile `CustomEvent`), the window
is left with a `crust` whose `ready` never resolves and whose stream was never opened. A retry by
re-running the bootstrap is ignored at line 24. The api should be published only after the
transport is live, or the guard should be reset on a failed connect.

---

## F4 (low) — `once()` waiters have no timeout or cancel and are consumed by the first matching frame

- `src/bridge/client/install.ts:115-121` — `once()` pushes a resolver into `waiters` and attaches,
  with no timeout and no returned cancel.
- `src/bridge/client/install.ts:78-82` — `dispatch` deletes the whole waiter array and resolves
  every entry with the current payload.

**Reached:** `await crust.once("never-emitted")` leaks a pending promise and a waiter entry for the
page's lifetime — there is no rejection/timeout path. A second partial-failure case: if a `listen`
callback for event `X` synchronously calls `once(X)` during `dispatch`, the new waiter is appended
to the array that `dispatch` then resolves, so the new `once` resolves with the *current* frame
instead of the next one, breaking the "next payload" contract.

---

## F5 (low) — a malformed binary result throws a raw `DOMException`, not a `CrustInvokeError`

- `src/bridge/client/invoke.ts:79-80` — `Uint8Array.from(atob(value.__crustBytes), …)` calls `atob`
  outside any guard; invalid base64 throws a bare `DOMException`.
- `src/bridge/client/invoke.ts:88-94` — the `fail()` constructor is the only path that produces the
  documented page error shape, and it is not used here.

**Reached:** A handler whose result carries `__crustBytes` with non-base64 text makes `invoke()`
reject with a `DOMException`. `isCrustInvokeError()` (`error.ts:11-19`) correctly refuses it, so a
page that checks the error type falls through to a generic handler. This is a result-decoding
partial failure that escapes the client's own error contract.

---

## F6 (low) — unsubscribe never detaches; `asked` stays latched

- `src/bridge/client/install.ts:103-113` — the `listen()` unsubscribe removes only the callback from
  the local `listeners` set; it never calls back into the invoke half.
- `src/bridge/client/invoke.ts:160-168` — there is no detach API; `asked[event]` stays `true` and the
  `stream.addEventListener` handler from `bound()` (`:171-174`) remains.

**Reached:** After `off()`, every later frame for that event still fires the retained EventSource
listener, reaches `dispatch`, and finds no listeners/waiters — a retained closure per unsubscribed
event, with no way to release the subscription. Not a functional misfire, but a leak and the reason
no re-subscribe/retry path exists for a torn-down listener.

---

## Coverage / not done

Read every file under `src/bridge/client/` and the two injected darwin scripts plus
`src/bridge/server/{events,invoke,bytes}.ts` and the four client test files. Confirmed agreements:
`__crustBytes`/`__crustLiteral` revive depth matches the server encoder; both transports call
`markHandshake` (`invoke.ts:112,144`); EventSource and fetch both carry the token (`?token=` vs
`Authorization: Bearer`); the content world's `relaying` map dedupes re-emitted `crust:sub`. No
source modified, no tests run. No probe was launched and no GUI was touched.
