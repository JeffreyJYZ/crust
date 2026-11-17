# darwin lane — fix wave

Lane `darwin`, owns `src/platform/darwin/**` except `arity.test.ts` and `dialog.test.ts`.
Report: `docs/reviews/defects-wave3/04-darwin.md`, findings 1–2. Both fixed.

## Finding 1 — fixed: closed window resurrects after Cmd+H

Root cause: `windowLiveness` was `visible || miniaturized || appHidden`. A closed window and an
open window in a hidden app both answer `isVisible=0, isMiniaturized=0`, so `appHidden=1`
made the closed one read open.

- `src/platform/darwin/shim/40_window.c` — new `shim_window_in_app_windows(app, win)` reads
  `-[NSApplication windows]`, guards with `class_getInstanceMethod` for `windows`, and returns 1
  only when the window pointer is an element. `-close` removes a window from that array at once;
  `orderOut`/Cmd+H does not. Preflight already verifies `NSApplication/windows`, `NSArray/count`
  and `NSArray/objectAtIndex:` (used by the sheet fallback), so no new selector list entry.
- `src/platform/darwin/index.ts` — declared `shim_window_in_app_windows: { args: [P, P], returns: I32 }`.
- `src/platform/darwin/shim-symbols.ts` — added the `LooseSymbol` member.
- `src/platform/darwin/liveness.ts` — `WindowLivenessState` gains `inAppWindows`; the function now
  returns false when membership is false, otherwise applies the original three-state rule.
- `src/platform/darwin/windows.ts` — `#isOpen` computes membership from the same `app` pointer it
  reads `-isHidden` from, and passes it through. Before `start()` there is no app pointer, so it
  fails open (`inAppWindows = !app`) rather than pruning every window.
- `src/platform/darwin/shim.test.ts` — added `(0, 0)` null-safety assertion for the new symbol.

Knock-on paths all read through `#isOpen`, so `labels()`, `handle()`, `webview()` and `number()`
now prune/report a closed window correctly even while the app is hidden; `window-adapter.ts`'s
`isOpen` and `create` duplicate-label check follow.

## Finding 2 — fixed: four NSWindow actions sent with wrong arity

`src/platform/darwin/shim/92_window_state.c` — `toggleFullScreen:`, `zoom:`, `miniaturize:` and
`deminiaturize:` each take one `id sender`. Replaced the two-parameter `(void (*)(void *, void *))`
casts with `(void (*)(void *, void *, void *))` and passed an explicit nil sender (`0`), so the IMP
no longer reads an undefined x2. The colon forms are already in `PREFLIGHT`.

## Tests added

- `src/platform/darwin/platform.test.ts` — "a closed window stays closed when the app is hidden":
  `{visible:false, miniaturized:false, appHidden:true, inAppWindows:false}` must be false. Without
  the fix the function ignored `inAppWindows` and returned true. Existing liveness cases gained
  `inAppWindows: true`.
- `src/platform/darwin/window-state-arity.test.ts` (new) — for each of the four action selectors,
  assert the body carries a three-parameter msgSend cast, an explicit `, 0)` sender and no
  two-parameter cast. Fails against the pre-fix C source; source-level because these bodies only
  run on a live AppKit event thread.

## Checks

`bun test` on my three own test files → 20 pass, 0 fail. `bun run check:lines` → PASS. `bun fmt`
with an explicit path list (7 TS files) → 7 unchanged. `bun check` → 17 errors in 3 files, none
under `src/platform/darwin` (`src/cli/parse.ts`, `src/platform/linux/platform.test.ts`,
`src/single-page.ts`) — other lanes' half-finished work, left untouched.

## Durable notes

- `-windowNumber` is not a liveness test: it keeps its value after `-close`. `[NSApp windows]`
  membership is the authoritative open/closed signal; `isVisible`/`isMiniaturized` alone cannot
  separate a closed window from one Cmd+H ordered out. Gate `appHidden` on membership.
- Every `objc_msgSend` cast must match the selector's real parameter count. Action selectors ending
  in `:` take `id sender`; pass nil explicitly instead of relying on whatever is in x2.
- `src/platform/darwin/arity.test.ts` checks declared ffi arity vs C arity, not internal msgSend
  casts — hence the separate source-level test for finding 2.
- Another lane was mid-edit on `arity.test.ts` during this run (`shimCSource is not defined`), so a
  combined `bun test` including it failed; not my file, not fixed here.
