# Hunt 22 — lane 13: the `testing` plugin and its adapters

Read-only review at HEAD `2174a6d`. No app launched, no focus taken, no source file changed, no e2e run.
Scope: `src/plugins/testing*.ts`, `src/plugins/testing-eval.c`, `src/runtime-testing.ts`,
`src/plugins/activation-policy.ts`, `src/config/{types-testing,validate-testing}.ts`, their tests and
the docs that describe them. Claims are `read` unless marked `measured`. Three throwaway scripts under
the approved temp dir drove the fake page and the adapter's injected table; nothing was written in the
repo. Finding line numbers are from the files as they stand at this HEAD.

## MEDIUM — the C completion-block table reuses slots by `id % 64`, so a late answer can settle a newer command

- where: `src/plugins/testing-eval.c:20-21,39-40,109-118,133-145` (slot choice at `:140-144`),
  `src/plugins/testing-eval-queue.ts:43-51` (the drop-by-id guard)
- mechanism: every evaluation writes its request id into `te_blocks[id % 64].id` immediately before
  sending (`:140-144`). The block passed to WebKit is a global block with no copy/dispose helper, so
  WebKit holds that same struct address; `te_invoke` reads `id` from it *at completion time* (`:110`),
  not when the request was sent. After 64 more evaluations the slot belongs to a different id.
  A completion that outlives its own 4 s JS timeout then carries the *new* id through the sink.
  `deliver()` drops completions only when their id is no longer in `waiters`
  (`testing-eval-queue.ts:44-47`); the stolen id is still pending, so the stale answer settles the
  newer command and that command's real answer is dropped as a duplicate. This reintroduces the exact
  cross-talk the id was added to stop (`docs/reviews/hunt-21/05-testing-namespace.md:9-29`,
  `docs/reviews/hunt-50/03-testing.md:7-30`).
- reachable by: an evaluation that answers after `EVAL_TIMEOUT_MS = 4000`, followed by 64 further
  evaluations before it arrives. Ordinary `waitFor` polling (`testing-observe.ts:51-74`) supplies the
  later evaluations: a modal sheet or a `confirm()` held for ~8 s makes one query time out, 64 polls
  advance the id, and the released page's answer lands on poll 65 under the wrong id. Two in-flight
  commands whose ids differ by exactly 64 collide without any timeout. No slot index is checked for
  liveness before overwrite, and no test covers the wrap.
- smallest fix: give each in-flight request its own block (or a generation field echoed with the id)
  and keep the slot occupied until its completion arrives, so a late block can never be rewritten
  under a fresh id.
- confidence: `read` — the C/JS state sequence is direct from source; no live `WKWebView` run here.

## MEDIUM — four answer paths drop the `fake` mark, so a fake-page answer reads as real-page proof

- where: `src/plugins/testing-observe.ts:55,59-64,67-71,86-92`;
  `src/plugins/testing-args.ts:64-69`; contract at `src/plugins/testing-types.ts:36-37,84-87,148-157`
  and `src/plugins/testing-honesty.test.ts:83-95`
- mechanism: `fakeAdapter` marks every JSON answer `fake: true` (`testing-fake.ts:99-111`), and
  `answered()` keeps that mark on page refusals (`testing-args.ts:114-119`). But `waitFor` rebuilds
  its own objects on all three exits — success (`:55`), wrapped page failure (`:59-64`) and timeout
  (`:67-71`) — none carrying `fake`. `console` with `hooked === false` calls `notImplemented()`,
  which creates a fresh `{ ok, code, message, requires }` with no mark (`:86-92`). `refused()` maps
  every adapter throw to a fresh failure with only `code`/`message` (`testing-args.ts:64-69`), so even
  the fake adapter's deliberate `unknown-window` refusal arrives unmarked. The honesty suite only
  checks `click`, `query` and a `not-found` refusal, so none of these paths is covered.
- reachable by: `measured` with the fake page and no window:
  - `waitFor({ selector: "#late", timeoutMs: 500 })` after the fake element appears →
    `{"ok":true,"found":true,"waitedMs":52}` (no `fake`);
  - a fake `querySelector` that throws → `query` answers
    `{"ok":false,"code":"handler-error","message":"page querySelector exploded","fake":true}` but
    `waitFor` on the same page answers `{"ok":false,"code":"handler-error","message":"testing.waitFor: #go probe failed after 0 ms: page querySelector exploded"}`;
  - `console({})` on a fake with no console tap → `{"ok":false,"code":"not-implemented",...,"requires":"PAGE_CONSOLE_SOURCE at document start"}` (no `fake`).
  A suite asserting `found: true` or `not-implemented` from these commands cannot tell the double
  from a real page, which is the contract the mark exists to enforce.
- smallest fix: propagate the source answer's `fake` into every derived success/failure, including
  the `notImplemented()` path (spread the mark at the call site or add it to the helper), and stamp
  adapter-thrown errors from the fake.
- confidence: `measured`.

## LOW — a second `darwinTestingAdapter` ignores the native table it was given

- where: `src/plugins/testing-darwin.ts:33-38,40-43,60-62,71-99,106-110`
- mechanism: `library`, `sink`, `evaluations` and `labeled` are module globals. `queueFor(table)` only
  builds a queue when `evaluations === undefined`, and `channel(table, queue)` only installs a sink
  when `sink === undefined`. Both closures capture the *first* table. `darwinTestingAdapter(web, table)`
  therefore uses the injected `table` exactly once per process; later adapters silently send through
  the first table and the second table's `crust_testing_set_sink` is never called. A second compiled
  library would receive no completions at all. `setTestingAdapter(undefined)`
  (`testing.ts:36-38`) clears only the plugin's `installed` field, not these globals — the teardown gap
  already reported at `docs/reviews/hunt-50/03-testing.md:115-129`.
- reachable by: `measured` — constructing two adapters with distinct fake tables and evaluating once
  through the second produced `{"firstTableEvals":1,"secondTableEvals":0}`. All production call sites
  use the default table, so this is a dead injection seam today rather than a live failure; it also
  makes the adapter impossible to isolate in one process.
- smallest fix: own sink and queue per adapter (which also fixes the teardown gap), or at minimum
  re-install the sink when a different table is supplied and key the queue by table.
- confidence: `measured` (injected-table routing), `read` (sink consequence).

## LOW — `click` verification misses a real click when a page listener calls `stopImmediatePropagation`

- where: `src/plugins/testing-script.ts:79-87` (`click`) and `:92-100` (`clickAt`)
- mechanism: the watcher that sets `observed` is registered with `addEventListener("click", watcher)`
  at command time, so it sits *after* every listener the page already installed. At the target,
  bubble listeners run in registration order. An earlier listener calling
  `event.stopImmediatePropagation()` prevents the watcher from running, while `element.click()`
  still delivered the click. The command then answers `{ ok: true, clicked: false, verified: false }`
  for a click that demonstrably reached the page. The inverse false positive is already fixed
  (`testing-honesty.test.ts:74-80`), so this is a false-negative hole in the same honesty contract.
- reachable by: a framework or app listener on the button that stops immediate propagation (a common
  guard in composite widgets). Not covered: the suite's only listener pushes to an array
  (`testing-honesty.test.ts:56-72`).
- smallest fix: register the watcher in the capture phase (`addEventListener("click", watcher, true)`
  and matching `removeEventListener`), which runs it before target-phase bubble listeners.
- confidence: `read`.

## LOW — the fake's `elementFromPoint` returns the first sibling, not the topmost one

- where: `src/plugins/testing-fake-document.ts:34-49`; append order at
  `src/plugins/testing-fake-dom.ts:93-100`
- mechanism: `hit()` walks `children` in creation order and returns the first node whose rect
  contains the point. In a real DOM a later sibling paints on top, so `document.elementFromPoint`
  returns the *last* matching sibling. A `clickAt` suite against overlapping elements therefore
  clicks a different element than a real page would.
- reachable by: `measured` — two 100x100 siblings at `(0,0)`, `under` appended first and `over`
  second, made the fake answer `elementFromPoint: under`; a browser answers `over`.
- smallest fix: iterate children in reverse, and keep the existing `BODY` fallback divergence
  documented (`docs/reviews/hunt-21/05-testing-namespace.md:87-106`).
- confidence: `measured`.

## LOW — one `NSString` per evaluation is never released in the C unit

- where: `src/plugins/testing-eval.c:58-66,133-145`
- mechanism: `te_nsstring()` returns `[[NSString alloc] initWithBytes:…]` and nothing calls
  `release`; the only `release` token in either file is a comment (`testing-eval.c:56`).
  `crust_testing_eval` sends this string to WebKit and returns without releasing it. WebKit copies or
  retains the script for the evaluation, so one retain per command accumulates for the process
  lifetime. The TS-side buffer leak from earlier hunts is fixed (`testing-eval-queue.ts:27-30`); this
  native-side leak is separate.
- reachable by: `read` — a probe loop issuing thousands of `query`/`waitFor` polls allocates one
  script string each; a long or unbounded probe grows without limit.
- smallest fix: send `release` to `text` after `evaluateJavaScript:completionHandler:` returns (or
  use an autoreleased constructor under a pool that is drained each tick).
- confidence: `read`.

## Still open from earlier hunts — confirmed present at this HEAD

Not re-argued here; each was reported before and the named code is unchanged:

- `visible()` reads only the element's own computed style, so an ancestor with `opacity: 0` or a
  child that overrides inherited `visibility: hidden` reports `visible: true`
  (`src/plugins/testing-script.ts:36-41`; `docs/reviews/hunt-50/03-testing.md:100-113`).
- `web(label)` is resolved before the per-label chain drains, so a window closed while commands queue
  leaves a stale pointer sent to `evaluateJavaScript` (`src/plugins/testing-darwin.ts:113-129`;
  `docs/reviews/hunt-50/03-testing.md:66-81`).
- `answered()` accepts any object whose `ok` is not exactly `false`, with no command-shape check
  (`src/plugins/testing-args.ts:72-105`; `docs/reviews/hunt-50/03-testing.md:83-98`).
- The 4 s timeout rejects with an uncoded error, which `refused()` flattens to `handler-error`, so
  `waitFor` aborts a slow page instead of retrying to the caller's deadline
  (`src/plugins/testing-eval-queue.ts:79-82`, `src/plugins/testing-args.ts:64-69`;
  `docs/reviews/hunt-50/03-testing.md:50-64`).
- No reset clears the darwin module globals on teardown; `createLabeledQueue().clear()` exists but is
  never called (`src/plugins/testing-darwin.ts:60-62`, `src/plugins/testing-eval-queue.ts:111-113`;
  `docs/reviews/hunt-50/03-testing.md:115-129`).

## Checked and clean

- `read`/tested: the `CRUST_TEST` gate still reads exactly `"1"` and registers no namespace otherwise
  (`src/plugins/core.ts:49-63`, `testing-gate.test.ts:24-53`).
- `read`: selector/text/point/timeout/since/label guards reject bad input with `bad-request` before a
  script runs (`testing-args.ts:35-61`, `testing-drive.ts:31-57`, `testing-observe.ts:34-45,77-81`).
- `read`: all page arguments are embedded through `json()` inside one IIFE (`testing-script.ts:60,69-75`);
  no earlier-hunt injection regression found.
- `read`/tested: late completions are dropped by request id and per-window queues no longer block each
  other (`testing-eval-queue.ts:43-51,94-115` and its four tests at `testing-eval-queue.test.ts:21-125`).
- `read`/tested: `type` uses the prototype value setter and the fake reproduces a framework tracker
  (`testing-script.ts:102-121`, `testing-fake.ts:117-145`, `testing-input.test.ts:13-37`).
- `read`: FFI declarations match the three C prototypes and the four-argument sink; the sink pointer is
  validated before it is handed to `crust_testing_set_sink`
  (`testing-darwin.ts:33-38,50-55,64-87`, `testing-eval.c:121-145`).
- `read`: `testing.activation` is validated as a closed enum and applied before platform construction
  (`validate-testing.ts:3-28`, `app-loop.ts:47-62,97-108`, `activation-policy.ts:17-65`).
