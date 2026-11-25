# hunt-21 · lane 05 — the `testing` namespace

Field: `src/plugins/testing*.ts` (args, darwin, drive, eval, fake-dom, fake-document, fixture, gate,
input, live, observe, run, script, console), `src/plugins/testing-eval.c`, and the `CRUST_TEST` gate.

Every claim below is labelled `measured` (I ran it) or `read` (I read the code). Nothing here was run
against Windows or Linux, and no e2e suite, GUI app or `agent-desktop` was launched.

## MEDIUM — a timed-out evaluation's late completion settles the *next* command with the stale answer

- where: `src/plugins/testing-darwin.ts:65,85-96,131-135,170-171` and the C block in `src/plugins/testing-eval.c:101-110`
- mechanism: `pending` is a single global slot and the completion block carries no request id, which
  the file's own header names (`testing-darwin.ts:7-8`). On timeout the code does
  `pending = undefined; reject(…)` (`:131-135`) but the script is **already in flight in WebKit** —
  `crust_testing_eval` returns `0` the moment `-evaluateJavaScript:completionHandler:` is *called* and
  the answer arrives later. When that late answer lands, the sink (`:85-96`) reads whatever `pending`
  holds *then*. If the queue has advanced (`:170-171`), `pending` is the next command's slot, so the
  next command resolves with the previous command's answer and the real next answer is dropped
  (`answer === undefined → return 0`).
- reachable by: any evaluation that outlasts `EVAL_TIMEOUT_MS` (4 s) and then answers. `measured` with
  a faithful replica of the same state machine (`pending` slot + FIFO `queue` + 30 ms timeout):
  `call1=timeout` / `call2 pending=true` / `late completion -> settled type#name` /
  `call2 -> answered with {"ok":true,"value":"STALE-FROM-CALL1"}` — a replica of the TS state machine,
  not a live `WKWebView` run. The `waitFor` loop (`testing-observe.ts:44-62`) is the ordinary way to
  reach it: every poll is a fresh evaluate, so a page blocked on a modal sheet or a `confirm()` makes
  each query time out and the next inherit its answer.
- smallest fix: correlate by a monotonic id — stamp each `pending` with an id, and have the sink drop a
  completion whose id is not the current one (or resolve a per-id waiter table keyed the same way the
  C block could carry if the block were per-call instead of global).

## MEDIUM — a command against one window blocks behind a hung evaluation on another window

- where: `src/plugins/testing-darwin.ts:142,170-171`
- mechanism: `queue` is one process-global promise chain, not per-window, even though `label` selects
  the webview (`:157`). `evaluate` appends `queue.then(…)` unconditionally, so a command naming
  `window B` waits for the whole chain already queued by `window A`.
- reachable by: `measured` from the same replica — with A's evaluate hung at its timeout, B's
  submission stayed queued until A's slot cleared. In production: `click` a page that pops a modal
  sheet (4 s), then `query` a second window — the second window's query is blocked ~4 s per pending
  A-command, and the multi-window `waitFor` loop `testing-observe.ts:46` compounds it.
- smallest fix: key the queue by the resolved label (`Map<string, Promise>`), so only commands against
  the *same* webview serialise — the single-slot `pending` still needs the id from the finding above,
  but the cross-window stall disappears.

## LOW — `waitFor` reports a wall-time lie and returns a raw failure where the docs promise `not-found`

- where: `src/plugins/testing-observe.ts:43-62`; docs `site/app/docs/reference/api-testing/page.mdx:37,46`
- mechanism: `waited` counts `WAIT_INTERVAL_MS` per iteration (`:61`) and the loop only checks
  `waited >= timeout` (`:53`), so the value is the *configured budget*, not elapsed time — a
  `timeoutMs: 5000` returns `waitedMs: 5000` after whatever the polls actually cost. And a probe that
  answers with any non-`not-found` failure (e.g. `handler-error` from a throwing page, `:49-51`) is
  returned verbatim rather than becoming the `not-found` the docs describe.
- reachable by: `measured` — `waitFor(5000)` on a page whose each query costs the 4 s eval timeout
  reports `waitedMs: 5000` after ~101 evaluations; a page that throws returns `handler-error` where
  `page.mdx:46` says "expiry is `not-found`".
- smallest fix: accumulate real elapsed time from a `Date.now()` start (or return the measured wall
  time), and either document or wrap the non-`not-found` early return.

## LOW — every evaluated script buffer is retained for the process lifetime (unbounded growth)

- where: `src/plugins/testing-darwin.ts:98-99,121-124`
- mechanism: `const buffers = new Set<Uint8Array>()` and `buffers.add(kept)` with **no `delete` and no
  `clear` anywhere** (`measured`: `buffers.delete` and `buffers.clear` are both absent from the file).
  The comment says "stays reachable for the process lifetime: WebKit keeps the string, not our array" —
  but each entry is the whole script source, one per command.
- reachable by: `measured` — a long probe run issues thousands of `click`/`query`/`waitFor` commands;
  each retains its script (`pageScript` is ~0.7–1.4 KB of source, larger once wrapped). A multi-minute
  test run leaks megabytes; an unbounded loop leaks without limit.
- smallest fix: `buffers.delete(kept)` in the settle/fail/timeout paths (or drop the set entirely if
  WebKit copies the string synchronously, which the C side's `te_nsstring` already does).

## LOW — `click`/`clickAt` answer `{ok:true, clicked:true}` without proving a click reached anything

- where: `src/plugins/testing-script.ts:79-83,88-92`; docs `page.mdx:40`
- mechanism: the snippets call `element.click()` and return success unconditionally. No check that the
  element is visible, enabled, or hit-testable — `element.click()` dispatches a synthetic click on a
  hidden element just the same. The docs do say "Both answer only that a click was dispatched … assert
  the result with `query`" (`page.mdx:40`), so the envelope is honest; the trap is that the *fake*
  proves less than a real page (next finding), so a test that only checks `clicked:true` believes it
  drove the UI.
- reachable by: `measured` — `click {selector:"#hid"}` on a `display:none` element returns
  `{ok:true,clicked:true}`, and the fake reports the same; a real browser's `element.click()` on a
  hidden element also fires, so neither catches it.
- smallest fix: cheap honesty — have `click` refuse `not-found` (or a new code) when `visible(element)`
  is false, or rename the result field to `dispatched` so no caller reads it as "a user clicked".

## LOW — the fake's selector engine makes a passing suite certify selectors that fail in a real page

- where: `src/plugins/testing-fake-dom.ts:46-65`; `testing-fake.ts:4-5`; `testing-fake-document.ts:34-50`
- mechanism: the fake's `matches()` supports only `#id`, `.class`, `tag`, `tag#id`, `[name]`,
  `[name="v"]` and a three-part compound (`:48-64`); a union (`#a, #b`), a descendant (`main a`), a
  child (`body > a`), a pseudo (`a:first-child`) or any other real selector silently returns no match.
  A `query`/`click`/`type` against such a selector answers `not-found` in the fake and succeeds in a
  real browser. `elementFromPoint` has the mirror problem (`testing-fake-document.ts:42`): it refuses
  the `BODY` element, so `clickAt` over bare background answers `not-found` where a real browser
  returns `<body>`. The fake's `getComputedStyle` reads only inline `element.style`
  (`testing-fake.ts:92-96`), so a class-based hide (`class="hidden"` + a stylesheet) reads
  `visible: true` where a browser reads `false`.
- reachable by: `measured` — `#real`/`a` → fake found; `body > a`, `a[href]`, `main a`,
  `a:first-child`, `a, div` → fake `exists:false` with the element present; `clickAt(400,300)` over a
  bare body → fake `not-found`; `query '#hid'` with `class="hidden"` → fake `visible:true`, real
  browser `false`; `click '#hid'` → fake `{ok:true,clicked:true}`.
- smallest fix: either (a) document in `testing-fake-dom.ts` exactly which selectors are fake-only, and
  add a `fakeSupports(selector)` guard a suite can assert on, or (b) run the fake snippets against a
  real DOM engine (linkedom/happy-dom) instead of the hand-rolled matcher — then the fake and the
  browser answer the same shape.

## GATE — checked and clean

- **`CRUST_TEST` gate** (`src/plugins/core.ts:49-59`, `testing-gate.test.ts`): `measured` — reads
  exactly `"1"`, so `"0"`/`"true"`/unset are all false, and without it the registry has no `testing`
  name and `invoke` answers `unknown-plugin`. Nothing in `src/` or `scripts/` sets the variable besides
  the reader, so `crust build`/`crust dev` ship no handler.
- **Script injection** (`testing-script.ts`): `measured` — hostile `selector`/`text`/`key` values
  (`a");<img onerror=…>`, `"); fetch("/_crust/log",{headers:{authorization:"Bearer "+…}}); ("`,
  `x"}); evil(); //`) all serialise through `json()` and produce a snippet that parses as one IIFE with
  no top-level breakout. `U+2028`/`U+2029` in `text` parse fine in Bun's `new Function` (so no
  line-terminator escape). The one structural limit: `requireSelector`/`requireText`
  (`testing-args.ts:41-55`) accept any non-empty string — a selector is passed to `querySelector`, so
  it is the page's own selector engine, not code execution; the escape is contained by `json()`.
- **Argument validation** (`testing-args.ts:29-55`, `testing-observe.ts:35-42,65-69`): `read` —
  `label`/`selector`/`text` non-empty, `x`/`y`/`timeoutMs`/`since` finite and right-signed, `modifiers`
  coerced to booleans. An invalid selector reaches `querySelector` and becomes a page-side
  `handler-error` (the browser's own message), which is honest.
- **Code bridging** (`testing-args.ts:58-63,66-103`): `read` — a page `not-implemented`/`not-found`
  refusal maps through; an unknown page code collapses to `handler-error`; a non-string or non-JSON
  answer becomes `handler-error` naming what arrived. `not-implemented` for `console` is gated on
  `hooked === false` (`testing-observe.ts:74-81`), so a page without the tap cannot read `[]` as
  silence.
- **C arity/width** (`testing-eval.c:113-134` vs `testing-darwin.ts:50-53`): `read` —
  `crust_testing_available(void*)→int`, `crust_testing_set_sink(void*)→void`,
  `crust_testing_eval(void*, const char*, long long)→int`; the declared args `[P]`, `[P]`,
  `[P, P, I64]` match exactly, and the length is passed as `BigInt` (`testing-darwin.ts:125`) to match
  the `long long` prototype.
- **Fake vs live core split**: `measured` — the same `pageScript` source runs through `fakeAdapter`
  (`new Function`, `testing-fake.ts:72-98`) and through the live test's real `WKWebView`
  (`testing-live.test.ts`), and the `type` native-setter trap is proven both ways (fake:
  `trackFrameworkValue` `testing-fake.ts:110-132`; live: the `value` accessor in the page,
  `testing-live.test.ts:29-42`). The split is sound for the shapes the fake models; the divergences
  are the selector/getComputedStyle/elementFromPoint gaps above.
- **`not-implemented` without a platform**: `measured` — `createTestingPlugin()` with no adapter
  answers every command `not-implemented` naming the WebKit call (`testing-args.ts:20-26`); the darwin
  adapter is installed only when `testingEnabled()` (`runtime-testing.ts:24-28`).