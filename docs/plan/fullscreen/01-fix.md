# Lane A — the fix

Read `docs/plan/fullscreen/BRIEF.md` first.

## Own

- `src/platform/darwin/window-create.ts`
- `src/platform/darwin/window-create.test.ts` (new, if a pure helper is worth extracting)
- `src/platform/darwin/shim/40_window.c` **only if** you need a read-back symbol
- `src/platform/darwin/shim-symbols.ts` and `src/platform/darwin/index.ts` for that symbol's
  declaration and its `bun:ffi` arity (arity must match the C prototype exactly —
  `src/platform/darwin/arity.test.ts` fails the suite otherwise)

Nothing else. `scripts/**`, `site/**` and `docs/**` belong to other lanes.

## What to do

1. Replace the collection behaviour with one that makes the window fullscreen-primary **and** keeps
   the recorded launch behaviour: the window appears on the Space the user is looking at. Prefer
   `MoveToActiveSpace | FullScreenPrimary` (130) over `CanJoinAllSpaces | FullScreenPrimary` (129),
   and state in the comment why the all-spaces bit is gone, not just that it changed.

2. Read it back and prove it. Extend the existing diagnostics block at the bottom of
   `createNativeWindow` (the one that already prints `window … number …, visible …, on active space …`)
   with the measured `collectionBehavior` and whether the style mask carries
   `NSWindowStyleMaskFullScreen` (`1 << 14`). A read-back symbol beside `shim_window_is_on_active_space`
   in `shim/40_window.c` is the honest way: `collectionBehavior` and `styleMask` are both direct
   AppKit reads, one guarded `objc_msgSend` each.

3. Keep the existing `isOnActiveSpace` behaviour. If you can measure that the launch still lands on
   the active Space, say how; if you cannot, say that too rather than asserting it.

4. If a pure decision helper (for example a `collectionBehavior()` function returning the constant)
   makes the choice testable without AppKit, extract it and test it. Do not write a test that only
   restates the literal.

## Prove

- `bun run test` — full suite, paste the pass/fail counts.
- `bun check` — paste the file count and "no type errors".
- `bun run check:lines` — paste the verdict.
- The read-back values you measured, quoted from real output, and how you obtained them (which app,
  which command). If you need a window, use `examples/hello` built with `crust build --dir`, launch
  its binary directly under a `guardFocus()`/`restoreFocus()` harness, and hand focus back.

## Final message

Under 15 lines: the constant you chose and why, what you measured, the gate results. No pledge about
future work.
