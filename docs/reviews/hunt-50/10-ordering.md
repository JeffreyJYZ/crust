# Ordering and races — `src/plugins/network*`, `navigation*`, `findinpage*`

Read-only hunt. Scope: the three plugin families and the darwin adapters/shims that make their
callbacks reachable, since the ordering guarantees are split across that seam.

**Count: 6 findings** (2 high, 3 medium, 1 conditional).

**Worst: F1 — find completion has no identity, so a superseded or cross-window search settles the
wrong promise (and repeats the wrong text).**

---

## F1 (high, worst) — one global `pending` + one global C sink; the find completion carries no task id

- `src/platform/darwin/find.ts:31` — `let pending: … | undefined` is a single process-wide slot.
- `src/platform/darwin/find.ts:59-63` — `supersede()` fails the old promise but cannot cancel the
  WebKit search already in flight. The comment at line 58 ("a search that was already running cannot
  answer for the next one") is false: nothing stops its completion handler from firing.
- `src/platform/darwin/find.ts:43-49` — the completion callback takes only `found: number`, clears
  `pending`, and settles whatever is there. No webview, no token.
- `src/platform/darwin/shim/108_find.c:41` — one global `find_sink`.
- `src/platform/darwin/shim/108_find.c:84-91` — `find_invoke` reports a single BOOL, no identity.
- `src/platform/darwin/shim/108_find.c:130-135` — `find_last` (the string `next`/`previous` repeat)
  is one global; a second search overwrites the first window's text.
- `src/platform/darwin/shim/108_find.c:146-155` — `crust_find_repeat` uses that global `find_last`
  even when aimed at a different webview.

**Reached:** (a) a page calls `findinpage.search` twice without awaiting (`Promise.all`): call 1 sets
`pending` and sends; call 2 `supersede()`s it (caller 1 gets an error for a search that actually
succeeded), sets `pending` to itself and sends. WebKit's completion for search 1 arrives first and
settles call 2's promise with search 1's result; search 2's own completion finds `pending ===
undefined` and is dropped. (b) Window A searches, window B searches before A's completion: B's
result is attributed to whichever `pending` is set, and `next()` on A repeats B's text (overwritten
`find_last`) in A's webview. The JS `matchCase` map at `find.ts:127` is per-webview but cannot help,
because the C string and sink are global. The 4 s timeout at `find.ts:94-102` makes it worse: after a
timeout the late completion can still settle a later search.

---

## F2 (high) — `navigation` events are emitted to the last command's page, not the page that started the delegate

- `src/plugins/navigation.ts:79` — one module-level `sink`.
- `src/plugins/navigation.ts:106,127,144,160,168,176,188` — **every** command (start, stop, state,
  reload, goBack, goForward, loadUrl) assigns `sink = ctx.emit`, not just `start`.
- `src/plugins/navigation.ts:108-114` — the listener registered by `start` calls that shared `sink`,
  not the `ctx.emit` captured at start time.
- `src/platform/darwin/navigation.ts:50,70-89,108-114` — the native adapter keeps listeners per
  webview, but each listener funnels into the one `sink`, so per-view routing does not save it.

**Reached:** Two pages/windows. Page A calls `navigation.start` (`sink` = A). Page B calls any
navigation command — even one that fails validation, because `sink = ctx.emit` runs *before* `run`
checks the label/adapter (`navigation.ts:127,144,160`) — so `sink` = B. From then on, A's
`did-start`/`did-commit`/`did-finish`/`did-fail` events are delivered to B's page. A never sees its
own load lifecycle; B sees events for a page it does not own. Deterministic, no concurrency needed.

---

## F3 (medium) — `network:request` events go to whichever page last called a bookkeeping command

- `src/plugins/network.ts:73` — one module-level `context`.
- `src/plugins/network.ts:120` — `decide()` emits `network:request` to that one `context`.
- `src/plugins/network.ts:150-174` — `rules`, `setRules`, `log`, `clearLog` each overwrite it;
  `status` and `onChange` do not.
- `src/platform/darwin/network.ts:64,69-90` — one `reply` decision is shared by the decide and fill
  callbacks.

**Reached:** Page A calls `network.rules` or `network.log` (`context` = A). Page B calls
`network.log` to read its own log (`context` = B). Every intercepted request from every window now
emits `network:request` to B. A page that only calls `network.status`/`onChange` never sets
`context`, so a request stream exists but is delivered to a stale page or nowhere. Same class as F2,
same root cause: a single mutable emit channel for a multi-page feature.

---

## F4 (medium) — a transient install failure is cached forever; the scheme handler never retries

- `src/plugins/network.ts:124-131` — `ready()` sets `install` on first call and never clears it.
- `src/plugins/network.ts:133-142` — `state()` calls `ready()`, so `rules`/`setRules` report that
  cached result indefinitely.
- `src/platform/darwin/network.ts:94-101` — `install` returns `ok:false` with a "needs the
  WKWebViewConfiguration a window is built from" reason when `options.configuration?.()` is still
  undefined. That is a timing condition, not a permanent refusal.

**Reached:** A page calls `network.setRules`/`network.rules` before a window exists (or before the
configuration callback can supply one). `ready()` caches the `ok:false` install. The window is then
built, but every later `state()` returns the cached `registered:false`; interception is permanently
off for the process even though the precondition now holds. Ordering/lifecycle defect: the lazy init
latches the earliest, worst-timed answer.

---

## F5 (medium) — repeated `network.onChange` re-schedules the OS observer; events duplicate

- `src/plugins/network-status.ts:73-75` — comment claims "a second call replaces the listener set,
  so a page that re-registers does not stack duplicate `network:change` events."
- The JS `listener` is indeed replaced (`src/platform/darwin/network-status.ts:77-79`), but
  `src/platform/darwin/shim/120_network_status.c:59-65` — `ns_watch()` calls
  `SCNetworkReachabilityScheduleWithRunLoop` on every call and there is no matching
  `SCNetworkReachabilityUnscheduleFromRunLoop`.

**Reached:** A page calls `network.onChange` twice (re-register, or two pages subscribe). Each call
schedules the same reachability target on the main run loop again. One OS change now invokes
`ns_callback` once per schedule, so the single current `listener` fires N times — N duplicate
`network:change` events. The plugin-level promise of "replaces, does not stack" is not kept.

---

## F6 (conditional on WebKit issuing concurrent scheme tasks) — global native buffers and `reply` cross tasks

- `src/platform/darwin/shim/110_network.c:29` — `net_text` is one global; `net_start` (`:92-110`)
  copies the task's URL into it before calling `net_decide`.
- `src/platform/darwin/shim/113_network_serve.c:14-15` — `net_body`/`net_mime` are globals.
- `src/platform/darwin/network.ts:64` — one `reply` is set by the decide callback (`:69-75`) and
  read by the fill callback (`:78-90`).

**Reached:** WebKit can call `webView:startURLSchemeTask:` for more than one request before earlier
ones finish (multiple concurrent page requests / windows share one handler). Task B's `net_copy`
overwrites `net_text` while task A's URL is still queued for `net_decide`; both decisions are then
made from the last URL, and the shared `reply` can be replaced between A's decide and A's fill.
Result: a request is matched/served against the wrong rule and body. Conditional because it needs
concurrent `startURLSchemeTask:` calls; the shared state itself is unconditional.
