# Authority and capability timing — `src/bridge/server/handler*`

Read-only hunt. Scope: `src/bridge/server/handler.ts` and the checks it drives in
`invoke.ts`, `capabilities.ts` and `actions.ts`. Traced the callers that supply the
credential and its label (`src/bridge/server.ts`, `window-identity.ts`,
`window-create.ts`, `app-loop.ts`, `runtime.ts`) to establish reachability. `rg`/`fd`
only; no source touched, no gate run, no GUI probe.

**Count: 2 findings** (1 high, 1 low). The token-to-label binding on invoke is sound:
`handler.ts:163-178` takes authority only from `state.labels.get(headerToken)`, and
`invoke.ts:59-65` checks it before the handler runs. What remains is at the two edges —
the point where a credential gets its label, and the point where a request's capability
is checked relative to its payload.

**Worst: F1 — a seed token carries no label, so the bridge decides its authority later, from a request-supplied `?window=` on the first mint.**

---

## F1 (high, worst) — mint authority is deferred to request time and read from the URL

- `src/bridge/server.ts:55-57` — the process token is inserted into `labels` as
  `main`, but it is also the sole entry in `seeds` (`handler.ts:57`). Nothing in the
  token ties it to `main` for *minting*: a seed can bind a new credential to any label.
- `src/bridge/server/handler.ts:73-80` — on a document GET, `presented` is the token
  from the URL and `label` is `windowLabelFromSearch(url.search)`, i.e. a value the
  requester wrote.
- `src/bridge/server/handler.ts:87-95` — `if (seeds.has(presented) && origin === null)`
  mints `mintDocumentToken(ledger, label)` and 302s the new credential back in the
  `location`. The label check is absent: the only authorisation question asked is "is
  this a seed and did the request omit `Origin`". A top-level navigation and a
  same-origin GET fetch are indistinguishable to that test.
- `src/bridge/server/invoke.ts:60-65`, `handler.ts:177` — the minted token's label is
  then the *sole* authority for the capability gate. A granted label is a real
  capability boundary once minted; this is the step that lets a caller cross it.
- `src/plugins/window-create.ts:60,66-70,73` — in a built/plain-HTML app
  `currentBridgeToken()` returns the process seed (`src/runtime.ts:134` records it
  whenever there is no `dev.url`), and a relative create URL is written as
  `/?window=<label>&token=<seed>`. The label is `parsed.options.label`, the page's
  own `window.create` argument.
- `src/app-loop.ts:61` — configured windows get the same treatment: the process seed
  is appended to every `windowUrl` in a built app.

**Reached:** Configure `grants: { main: ["window:create"], admin: ["secret:*"] }`.
A page whose document token is bound to `main` calls
`window.crust.invoke("window", "create", { label: "admin" })`. It passes the gate
because `main` holds `window:create`. The host emits
`/?window=admin&token=<process seed>` and navigates the child to it. That navigation
has no `Origin`, so `handler.ts:87` mints a document token bound to `admin` and the
child's address bar carries it. The child invokes `test:secret` (or any `admin`
command) with `authority === "admin"` and gets 200. The parent never held `admin` and
never needed to capture the seed — it only named a label. The decision about which
authority the new credential gets was made at mint time from that name, which is
exactly the field the capability model says is a routing hint, not authority
(`window-identity.ts:15-19`). Dev mode is exempt because `publishDevHandshake` injects
a non-seeding `main` token instead (`runtime-host.ts:61-76`), which is why this hides
in `crust dev`.

The comment at `handler.ts:84` claims `window.create` "replaces any page-chosen
`?window=` before the seed is appended"; what it replaces it with is the page's
`window.create` `label` argument. No check compares that label with the caller's bound
label.

---

## F2 (low) — the capability decision is made after the whole payload is buffered and parsed

- `src/bridge/server/invoke.ts:133-136` — only the client's `content-length` claim is
  checked early; a chunked POST has none.
- `src/bridge/server/invoke.ts:150,161` — `readCappedBody` streams and retains up to
  `MAX_BODY_BYTES` (2 MiB) before any action is known.
- `src/bridge/server/invoke.ts:164-174` — the body is decoded and `JSON.parse`d, and
  `plugin`/`command` validated, still before the gate.
- `src/bridge/server/invoke.ts:59-65` — `capabilities.allows(authority, candidate)`
  is reached only inside `run`, called at `:153` (binary) and `:176` (JSON).

**Reached:** A page with a valid but low-grant document token passes the bearer check
at `handler.ts:163` and POSTs `test:secret` with a 2 MiB body. The bridge reads all
2 MiB into `chunks`, copies it into a new `Uint8Array`, decodes it, and parses the JSON
before answering `403`. The per-request cost is capped, but an unauthorised caller can
repeat it indefinitely: the authorisation decision that would reject the call is the
last step, not the first. Moving the `capabilities.allows` check ahead of
`readCappedBody` (using the query/body command name only to pick the action) would
make denial cheap and keep the cap as a backstop.

---

## Checked and clean

- `handler.ts:161-168` — `issued()` uses `labels.has`; a UUID the bridge never minted
  is refused on both invoke and events. `queryToken` is read only for `EVENTS_PATH`
  (`:157`), so an invoke cannot authenticate through `?token=`.
- `handler.ts:177` — `authority` comes from `state.labels.get(headerToken ?? …)`.
  The `?? token` tail is unreachable on invoke because `issued()` has already
  required a valid `headerToken`; no body/query field can supply authority.
- `capabilities.ts:77-108` — no config returns `OPEN`; a non-empty list denies by
  default with a compiled per-label pattern table; `allows(undefined, …)` is false
  once a list is configured. `actions.ts:30-43` checks both `app:<name>` and the
  legacy flat `app:invoke`, so narrow grants work without widening the alias.
- `invoke.ts:66-71` — the capability check precedes `handler(args, request)`; no
  handler side effect runs before denial.
- `handler.ts:148-153` — a present foreign `Origin` is refused on invoke/events;
  an absent one is allowed because WebKitGTK's `EventSource` sends none and the bearer
  token remains the credential.
- `events.ts:82-133` — frames are JSON-encoded with CR/LF stripped from event names;
  teardown removes the subscriber from both sets. Events are app-wide by design
  (`PluginContext.emit` carries no label), so the missing per-window event filter at
  `handler.ts:170-172` is not treated as a capability boundary here.
