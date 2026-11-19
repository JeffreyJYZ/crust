# `src/plugins/testing*` hunt — 03

Scope: `src/plugins/testing*.ts` and `testing-eval.c`, read-only source inspection. The question asked
was what happens when the thing being driven is **slow**, **gone**, or **lying**. All claims below are
from `read` unless marked `measured`. No GUI app was launched, no cursor moved, no e2e run.

## HIGH (silent wrong answer, slow page) — a timed-out evaluation's late completion settles the *next* command

- where: `src/plugins/testing-darwin.ts:65` (`pending`), `:79-92` (the sink), `:102-138` (`evaluate`,
  timeout at `:131-135`), `:142`, `:170-172` (`queue`). The guarantee this breaks is stated at
  `:5-8`: serialization exists because "the block carries no request id".
- mechanism: there is one module-global `pending` and no request id in the C block. `evaluate`
  installs `pending` before sending. The 4 s timer clears `pending` and rejects, but WebKit's
  completion block is still in flight and still calls the sink. The sink reads whatever `pending`
  is *now*. If any command started in between (the queue advances as soon as the timeout rejects),
  that late completion reads the next command's `pending` and settles it with the previous
  command's answer; the next command's own completion then finds `pending === undefined` and is
  dropped. One slow evaluation therefore poisons every later command in the process with stale
  data, and the poisoned command reports `ok: true`.
- reachable by: any page that answers after `EVAL_TIMEOUT_MS` (4000 ms), followed by a second
  testing command. `waitFor` guarantees the second command: it re-issues `query` every 50 ms
  (`testing-observe.ts:45-61`), so within 50 ms of the timeout a new `pending` is installed for the
  late block to consume. Concrete bad outcomes: `waitFor` receives a `clicked`/`TypedResult` answer
  instead of a `QueryResult` (no `exists`, so it returns the stale object as a bogus success);
  `query` reports another selector's geometry; `type` reports another field's value. Teardown does
  not clear this state (finding 7), so cross-talk can also cross test cases.
- smallest fix: correlate the block with a request id. Mint a sequence in `evaluate`, pass it
  through `crust_testing_eval` into the global block (`testing-eval.c:27-33, 101-110, 125-133`),
  and have the sink settle only the `pending` whose id matches. An id also lets a late completion
  be discarded safely instead of racing the current one.

## HIGH (silent wrong duration, slow page) — `waitFor`'s timeout is a poll count, not wall-clock time

- where: `src/plugins/testing-observe.ts:43-61` (`waited` at `:44`, probe at `:46`, check at `:53`,
  increment at `:60-61`), constant at `:20-23`.
- mechanism: `waited` grows only by the fixed `pause(WAIT_INTERVAL_MS)` (50 ms). The time spent in
  `await run("query", …)` — which includes the round trip through `evaluateJavaScript` and, on
  darwin, `EVAL_TIMEOUT_MS` — is never counted. "Timeout" therefore means roughly
  `(timeout/50 + 1)` probes, not `timeout` milliseconds. The `waitedMs` returned on success is the
  same counter, so it is not elapsed time either.
- reachable by: a page where each query takes longer than 50 ms (heavy layout from
  `getBoundingClientRect`/`getComputedStyle` in the query script, a loaded page, or any WebKit
  round-trip delay). With a 1 s query and `timeoutMs: 100`, `waitFor` takes about 3 s and reports
  `waitedMs: 100`. With the default 5000 ms and a 1 s query it takes about 100 s for a "5 s" wait.
  The caller cannot bound the wait with `timeoutMs`.
- smallest fix: record a start timestamp (`Date.now()`/monotonic clock) and compare elapsed time
  against `timeout`, reporting the measured elapsed value. Keep a minimum one-probe guarantee
  explicitly if that is intended.

## MEDIUM (early, misleading failure, slow page) — the 4 s evaluation timeout makes the caller's `waitFor` timeout meaningless

- where: `src/plugins/testing-darwin.ts:29-30`, `testing-args.ts:57-63` (`refused`),
  `testing-observe.ts:46-52`.
- mechanism: a query that exceeds `EVAL_TIMEOUT_MS` rejects with an error that has no `code`, so
  `refused()` maps it to `handler-error`. `waitFor` treats any non-`not-found` failure as terminal
  ("a window that is gone or a page that threw will not fix itself by waiting"), so a single slow
  query aborts the whole wait immediately.
- reachable by: a page whose query script takes >4 s to evaluate, with `waitFor({ timeoutMs: 60000 })`.
  The wait ends after ~4 s with `handler-error`, not after 60 s with `not-found`. The caller cannot
  distinguish "page slow" from "page threw" because both arrive as `handler-error`; only the message
  differs.
- smallest fix: give the timeout error a distinct code (e.g. `timeout`) and either retry it inside
  `waitFor` until the caller's deadline or return it as a typed timeout result. At minimum tag it
  so callers can branch.

## MEDIUM (use of a gone window, gone page) — the webview pointer is resolved before the serial queue and used after it drains

- where: `src/plugins/testing-darwin.ts:149-172`, especially `:155-157` (eager `web(label)`) and
  `:170-171` (`queue.then(() => evaluate(table, view as number, script))`).
- mechanism: `web(label)` is called synchronously when the command is issued, but the returned
  `NSWebView` address is captured and only used later, once all earlier evaluations have settled.
  There is no liveness re-check at drain time. A window closed while commands are queued leaves a
  stale pointer that `crust_testing_eval` sends `evaluateJavaScript:completionHandler:` to.
- reachable by: issue two testing commands in one window quickly; close the window after the first
  evaluation starts. The second command evaluates in a freed/reused view — either no completion
  ever arrives (4 s timeout, reported as `handler-error`) or, worse, the completion belongs to a
  different view and feeds finding 1. On macOS the resolver may still return a nonzero pointer
  for a window whose close has not been pruned, so the `view === null || view === 0` guard at
  `:164-169` does not catch this.
- smallest fix: resolve `web(label)` inside the queued closure, immediately before the send, and
  re-run the liveness/`unknown-window` check there.

## MEDIUM (lying answer accepted, lying page) — `answered()` trusts any object whose `ok` is not exactly `false`

- where: `src/plugins/testing-args.ts:65-103`, especially `:92-93`
  (`if (answer.ok !== false) return parsed as PageAnswer;`).
- mechanism: the JSON envelope is checked only for `typeof === "object"` and `ok === false`. No
  command-specific shape is validated. `{ ok: true }`, `{}`, `{ ok: 1 }`, or an answer belonging to
  a different command all pass as valid results. Callers then read fields that are absent.
- reachable by: a page that returns a JSON object not produced by our snippets (a patched page, a
  console tap that replaced `crustInvoke`, or — most likely — the stale answer from finding 1).
  Examples: `waitFor` on `{ ok: true, clicked: true }` sees no `exists`, reads `code === undefined`,
  satisfies `undefined !== "not-found"` and returns that object as a successful wait with no
  `found: true`; `click` on `{}` reports success although nothing was clicked; `query` on `{}`
  yields `undefined` visibility/geometry.
- smallest fix: validate the answer per command (at least the discriminants: `exists` for
  `query`/`waitFor`, `clicked`/`hovered`/`value`/`key` for the drive commands, `hooked`/`entries`
  for `console`), and reject unrecognized shapes as `handler-error`.

## LOW (lying visibility, lying page) — `visible()` reads only the element's own computed style

- where: `src/plugins/testing-script.ts:36-41` (`visible`), used by `query` at `:150-173`.
- mechanism: `visible()` calls `getComputedStyle` on the element alone. An ancestor's
  `visibility: hidden`/`collapse` or `opacity: 0` is not inherited into a child that sets its own
  `visibility: visible`/`opacity: 1`, and a nonzero bounding rect is still produced for a
  visibility-hidden (laid-out) subtree. So an element the user cannot see reports `visible: true`.
  Occlusion by an overlay is likewise never checked (`clickAt` uses `elementFromPoint`; `query`
  does not).
- reachable by: `query({ selector: "#child" })` where `#child` sits in a `visibility:hidden`
  container but declares `visibility:visible`, or in an `opacity:0` parent. The answer says
  `exists: true, visible: true` with a real rect.
- smallest fix: walk ancestors for `visibility`/`opacity`/`display`, or use `elementFromPoint` at the
  rect's centre and check whether it resolves to the element or a descendant.

## LOW (lingering state after teardown, gone window) — adapter teardown does not reset the darwin module globals

- where: `src/plugins/testing.ts:32-38` (`setTestingAdapter` clears only `installed`),
  `src/plugins/testing-darwin.ts:65-66` (`pending`, `sink`), `:98-99` (`buffers`), `:142` (`queue`).
- mechanism: `setTestingAdapter(undefined)` is the documented teardown (`testing-gate.test.ts:16-18`),
  but it cannot clear the adapter module's `pending`, `sink`, `queue` or the ever-growing `buffers`
  set. Every script buffer is retained for the process lifetime by design (`:98`), and a timed-out
  evaluation leaves its late completion able to consume the next adapter's `pending` (finding 1).
- reachable by: two adapters in one process (the gate test installs and clears one, a live test can
  install another). A completion from the first window arriving after the second adapter starts
  settles the second adapter's command. Over a long run `buffers` grows by one `Uint8Array` per
  evaluation, including all `waitFor` polls.
- smallest fix: expose a reset on the darwin adapter and call it from `setTestingAdapter(undefined)`;
  tie `pending`/`queue` to an adapter instance instead of module scope, and drop a kept buffer once
  its completion has fired.

## Checked and clean

- **Argument validation** — `read`: `labelOf`, `requireSelector`, `requireText`, `clickAt`'s
  `{x,y}` check, `waitFor`'s `timeoutMs` check and `console`'s `since` check in
  `testing-args.ts:28-55`, `testing-drive.ts:31-42, 52-57` and `testing-observe.ts:35-42, 66-69`
  reject bad input with `bad-request` before a script runs.
- **Adapter-absent and unknown-window mapping** — `read`: `missing()` names the exact WebKit call
  (`testing.ts:58-59`, `testing-args.ts:14-26`); the darwin adapter converts `bad-request` from the
  resolver and a null/zero view into `unknown-window` (`testing-darwin.ts:155-169`), and `refused()`
  preserves that code (`testing-args.ts:58-63`).
- **Console tap idempotency and isolation** — `read`/tests: `installConsoleHook` runs the bridge's
  page source against the fake page (`testing-fake.ts:52-56`); the tap is guarded against a second
  install and carries no token or fetch (`testing-console.test.ts:25-32, 74-79`). The `since` filter
  keeps entries at or after the timestamp (`testing-script.ts:175-183`).
- **`type`'s native-setter rule** — `read`: `testing-script.ts:94-112` routes through the prototype
  `value` setter and dispatches one bubbling `input` event; the fake reproduces React's own
  accessor (`testing-fake.ts:104-132`) and both the positive and the plain-assignment control are
  asserted in `testing-input.test.ts:13-37`.
- **C boundary types** — `read`: `testing-eval.c:21-33` builds a global block with
  `BLOCK_HAS_SIGNATURE` clear, `te_emit` reports nil/non-string results as kind 2
  (`testing-eval.c:70-84`), and every `bun:ffi` declaration in `testing-darwin.ts:32-37, 50-55, 78-95`
  matches its C prototype (`crust_testing_available`, `crust_testing_set_sink`,
  `crust_testing_eval`, and the sink's `(int, const char*, long long)`).
