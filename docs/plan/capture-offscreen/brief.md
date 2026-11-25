# Brief: `window.capture` fails for an offscreen probe while a fullscreen app owns the active Space

## Reported defect

An offscreen probe cannot capture its window at all while a fullscreen app owns the active Space.
`window.capture` answers no png, so programmatic screenshots fail exactly when the user is working
fullscreen.

## What is known before any lane starts

- macOS `window.capture` is `-[WKWebView takeSnapshotWithConfiguration:completionHandler:]`, called from
  `src/platform/darwin/shim/123_snapshot.c:158`. The unit builds a stack block by hand, one block per
  in-flight id in `125_snapshot_ids.c`, and the reads live in `124_snapshot_read.c`.
- The seam above it is `src/platform/darwin/snapshot.ts` (promise, request id, timeout) and
  `src/platform/darwin/snapshot-unit.ts` (compiles the three C parts with `cc()`).
- **Nothing in that path considers window visibility, window ordering, or Spaces.** There is no
  `collectionBehavior`, no `orderFront`, no `orderOut`, no space check anywhere in the snapshot unit.
- The unit answers statuses rather than throwing: `0 started`, `1 no webview or no snapshot selector`,
  `2 the configuration did not build`, `3 the completion block could not be built` — mapped by
  `snapshotStartReason(status)`.
- `crust` never activates or moves a window for a capture: the capture is documented as not taking
  focus (`activation: "none"` on the testing side), and the crust rule is that a probe must never steal
  focus, move a window, or park the cursor.

## The invariant that must not break

Capture must stay **non-activating and non-moving**. A fix that orders the window front, activates the
app, jumps Spaces, or resizes the window to make the snapshot succeed is not acceptable — it steals the
screen from a human who is using a fullscreen app, which is the worst outcome this repo has a rule
against. If a capture genuinely cannot be produced in some state, it must answer a named error, not a
blank png and not a hang.

## What each lane owns

**Lane A — fix (owns `src/platform/darwin/shim/12*_snapshot*.c`, `snapshot.ts`, `snapshot-unit.ts`,
`snapshot-unit.test.ts`).**

- Find why the snapshot produces no png when the window is not in the active Space, and fix it at the
  narrowest layer that can be tested. Candidates to weigh against measurement, not intuition:
  `takeSnapshot` on a webview whose window is ordered out / offscreen; the layer not being rendered
  because AppKit never draws an off-window view; `takeSnapshot` returning an image of zero size; the
  completion answering an error object.
- Keep the status codes honest: a new failure mode gets its own reason string in
  `snapshotStartReason`, because "no png" with no reason is what made this bug take a report.
- Prove it with a test that fails before the fix. A DOM-level or fake-ObjC-level test that reproduces
  the *state* (`window not ordered in`, `webview not in a visible window`) is worth more than an
  assertion that cannot go red.

**Lane B — measurement (owns only its own new probe file; no edits to the unit or the shim).**

- Measure, on this machine, which of these states answer a png today and which do not: window ordered
  front and on screen; window ordered front at `-4000,-4000` (offscreen coordinates, as
  `testing-live.test.ts` does); window ordered out; app hidden; webview never added to a window.
- Report the exact status or error for each, and whether the returned png is a real picture (non-zero
  pixels) or a blank one. A png that is 1×1 or all-transparent is "no picture" whatever the API says.
- Never take focus, never move a window, never park the cursor. Use `activation: "none"` and offscreen
  coordinates; if a state can only be reached by activating, say so instead of doing it.

**Lane C — docs (opens only after A's PR exists; owns `site/app/docs/reference/api-window/page.mdx`
and the `window.capture` section of `site/public/SKILL.md`).**

- State what `window.capture` requires of the window and what it answers when it cannot produce a
  picture. A caller writing an automated screenshot needs to know whether an occluded, offscreen or
  hidden window can be captured, and what the error looks like when it cannot.

## Constraints common to all lanes

- `bun check`, `bun run test`, `bun run check:lines`, plus whichever e2e owns the path. Every file at or
  under 200 lines; split rather than trim a comment that records a measured reason.
- Never run `bun fmt` without a path list — it rewrites sibling lanes' in-flight files.
- Push over HTTPS as jyzbot with `GIT_ASKPASS=/Users/jyz/dev/bin/git-askpass-gh`; one PR per lane; do not
  merge. Do not touch another lane's files, and do not edit `CHANGELOG.md` (the release owner writes it).
- Never take focus, move a window, park the cursor, or launch a GUI app in a loop. One launch per probe,
  and say before anything that takes the screen.
