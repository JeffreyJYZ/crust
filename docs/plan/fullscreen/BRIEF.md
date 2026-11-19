# Shared rules — macOS fullscreen fix

Repo: `/Users/jyz/dev/crust`. Read `/Users/jyz/dev/crust/AGENTS.md` first.

## House rules

- `rg`, never `grep`. `fd`, never `find`. `sd`, never `sed`.
- Never `bun fmt` without an explicit path list. Never npm.
- Every file at or under 200 lines, tests and examples included (`bun run check:lines`). Split by
  responsibility; never trim a comment that records a measured reason.
- One writer per file: only touch the paths your brief names.
- Never write to `~/.config/opencode/AGENTS.md` or any other agent memory file.
- Never launch a GUI app without `scripts/harness/guard.ts` (`guardFocus()` / `restoreFocus()`);
  every crust launch activates and steals focus, so the harness must hand it back.
- Never move the cursor or synthesize input.
- Never `open` a built bundle — run `X.app/Contents/MacOS/<bin>` directly.
- `process.exit()` skips `finally`: shape a harness `let code; try {…} finally {…} process.exit(code)`.
- Do not stop early or truncate a report. If something in the brief is wrong, say so with evidence
  and do the right thing.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## The bug

A crust window cannot enter real macOS fullscreen. The green button shows the zoom `+` (maximise to
the visible frame) instead of the two arrows, in both `crust dev` and a built `.app`.

`src/platform/darwin/window-create.ts:139-147` sets:

```ts
// `canJoinAllSpaces | fullScreenAuxiliary` = 257
S.vq1(win, "setCollectionBehavior:", 257);
```

`NSWindowCollectionBehaviorFullScreenAuxiliary` (256) marks the window as a helper that may appear
*inside* someone else's fullscreen Space, and explicitly disqualifies it as fullscreen-primary.
AppKit therefore swaps the green button to zoom.

Bit values: `CanJoinAllSpaces` 1, `MoveToActiveSpace` 2, `FullScreenPrimary` 128,
`FullScreenAuxiliary` 256, `FullScreenAllowsTiling` 2048.

The comment records why `CanJoinAllSpaces` was there: a launched window otherwise lands on the
desktop Space while the user is in a fullscreen one, invisible. That intent must survive the fix.

Note `CanJoinAllSpaces` is itself contradictory with `FullScreenPrimary` — a window present on every
Space has no single Space to transition into. `MoveToActiveSpace` (2) is the flag that expresses the
recorded intent: when the window is activated it moves to the active Space.

## Evidence bar

An assertion about AppKit is only true when measured. Read a value back from the live window; never
assert on a constant you just wrote, and never quote Apple documentation as the proof.
