# Does the window e2e have a deadline, or can it wait forever?

CI on `a8e8306` shows `gate (macOS): cancelled` at **exactly 15:00 after start**, while ubuntu and
windows passed. The macOS job's log is gone (`log not found: 134826390505`), so the evidence has to
come from the code.

The only thing that changed on that path in `a8e8306` is the new resize proof in `e2e:window`:

```
scripts/window/checks/resize.ts     viewport initial · resize larger · resize smaller
scripts/window/fixture/page.ts      viewport() and a resize() poll
scripts/window/fixture/page-prelude.ts
scripts/window/proof.ts             wired into WINDOW_CHECKS / EXPECTED_TAGS
```

A `cancelled` at a round number is what a hang looks like, not what a failed assertion looks like. Find
out whether this harness can wait forever.

## What to determine

1. **Every wait in the window proof has a deadline.** Trace what happens when the page never reports
   the viewport it was asked for: does the poll give up with a verdict (`page saw 900x640`), or does it
   spin until the runner kills the job? Look at `proof.ts`, `answers.ts`, the page fixture, and how a
   missing tag becomes a verdict rather than a hang.
2. **The child process is bounded.** If the app under test never prints the expected line, is there a
   wall-clock limit that kills it and reports, or does the parent wait on its exit forever?
3. **A timeout in the harness must not be mistaken for a pass.** A suite that exits 0 because it gave
   up is worse than one that hangs visibly.
4. **What a runner's display can actually do.** `window.setSize` to 1200x760 on a headless/CI display
   may be clamped by the WindowServer. If the assertion assumes the requested size is granted, say what
   the honest assertion is — the page must *follow* the window, not match a number the runner may
   refuse. Compare the page's viewport to the window's own `getSize`, not to the requested constant.

## What to change

Fix what is genuinely wrong — a missing deadline, a verdict that can never resolve, an assertion that
depends on the runner granting a size. **Keep the assertions meaningful**: the point is that a frozen
page fails, and it must still fail.

If the harness is already bounded and the 15-minute cancellation cannot be explained by this code, say
so plainly and say what else could produce it. Do not invent a cause to have one.

## Own

`scripts/window/**`, `scripts/e2e-window.ts`, `scripts/e2e-harness.ts`. Nothing under `src/` — three
lanes are editing `src/platform/**` right now.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt` without a
  path list. 200-line cap — split, never trim.
- **The e2e opens a real window.** Run it as `probe-run -c 'bun run e2e:window'` so the app that was
  frontmost is restored, and never leave a stray process running.
- **Bound every probe with `timeout`** and kill by explicit PID; an unbounded run is what we are
  investigating.
- Never `agent-desktop`, never move the cursor.
- Run every build and test in the foreground and wait for it inside the same call.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## Prove, and paste the output

- The code path that waits, quoted, and what bounds it now.
- `bun run e2e:window` green, with the timing line (`e2e-window: PASS  n/n assertions  X.Xs`).
- A deliberate failure: make the page report a stale size and show the suite fails **quickly** with a
  named verdict rather than hanging.
- `bun run test`, `bun check`, `bun run check:lines`.

Final message under 12 lines: whether the harness was bounded, what you changed, and your best
explanation for the 15-minute cancellation.
