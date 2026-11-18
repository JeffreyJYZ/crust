# Focus is stolen and never given back — and one failure poisons the next suite

Reported by the owner: "one or sm of the e2es still dont return focus. and when one doesnt all others
after return focus to wrong app".

That second sentence is the diagnosis: each suite captures the frontmost app **at its own start**, so a
suite that fails to restore leaves its own test window frontmost, and every suite after it dutifully
captures *that* and restores it. One leak cascades into a whole run of theft.

## What to determine, exhaustively

For **every** entry point that can bring a GUI app forward — `scripts/e2e*.ts`, `scripts/first-run.ts`,
`scripts/butter-sweep*`, and anything else under `scripts/` that launches a built binary or a dev
server:

1. Does it capture the frontmost app before it launches anything?
2. Is the restore reachable on **every** exit path — success, thrown error, `process.exit`,
   an early `return`, a signal, an unhandled rejection?
3. Does it use `process.exit(...)` in a position where a `finally` would not run? Note the shape that
   is safe (`process.exit(await main())` — main's own `finally` runs before it returns) versus the shape
   that is not (`try { process.exit(...) } finally { … }`).
4. Does it restore **before** or **after** it kills the app it launched? Restoring while the test window
   is still up can be undone by that window re-activating.

A suite that never captures is a leak too: `rg -l captureFrontmost scripts` lists the ones that do, and
the difference from the full set is the list of ones that do not.

## The cascade, stated so the fix can be judged

`scripts/e2e.ts` already captures the frontmost app once and restores it in its own tail. That is the
right place for the *outer* answer — a per-suite capture cannot know what the human was looking at
before the whole run started. Work out:

- whether passing the run's original app down to each suite (env var, or an argument) is the smallest
  correct fix, or whether each suite's own capture is enough once every path restores;
- whether `restoreFocus` should refuse to activate one of our own test binaries or a process with no
  window — a guard that turns a cascade into a single leak.

## Output

Write `docs/reviews/focus/FOCUS.md`: a table of every entry point with `captures`, `restores`, and the
exit paths where it does not, plus the ranked fix. **Do not edit any file** — another lane is editing
`scripts/e2e-harness.ts` and `scripts/e2e-window.ts` right now, and the fix lands after it reports.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt`.
- **Do not run the e2e suites to "see" the behaviour** — each one launches a GUI app and takes the
  screen, which is the bug you are investigating. Read the code. If you must run something, run a single
  suite under `probe-run -c '…'` and say which.
- Never `agent-desktop`, never move the cursor.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

Final message under 10 lines: which suites leak, the shape of the leak, and the single smallest fix.
