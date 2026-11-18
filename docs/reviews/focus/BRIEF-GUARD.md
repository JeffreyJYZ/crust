# Focus: the guard itself, and the cascade it cannot stop

Audited in `docs/reviews/focus/FOCUS.md`. Three leaks, and the reported one is the worst because it
hits every suite at once:

1. **No `process.on` anywhere in `scripts/`.** Ctrl-C, a `kill`, or a CI timeout skips every restore.
   This is the "one doesn't return focus" the owner sees, and it is the common case.
2. **Eight suites capture, then do work outside the `try`** (`mkdtemp`, `mkdir`, `clearSurvivors`), so a
   throw there skips the restore.
3. **`restoreFocus` runs `open -a <name>` unguarded**, so a suite that captured the *previous* suite's
   window faithfully restores it — that is the cascade.

This brief is **only the guard in `scripts/harness/focus.ts`**. The per-suite call sites are another
lane; do not edit any `scripts/e2e-*.ts`.

## What to build

1. **`guardFocus()`** — one call a suite makes once, which:
   - captures the frontmost app at the moment it is called,
   - restores it from `process.on("exit")` **and** on `SIGINT`, `SIGTERM`, `SIGHUP`,
   - is idempotent: calling it twice does not restore twice or capture the second time,
   - runs the restore **synchronously** where it must. An `exit` handler cannot await, so the restore
     inside it has to be a `spawnSync` of the same `osascript`/`open -a` the async path uses — the audit
     says exactly this, and it is the one place a blocking call is correct.
2. **A guard against restoring our own test app.** If the captured name looks like one of ours — a
   crust test binary, a `crust-e2e-*` scratch path, a process with no window — do **not** activate it.
   Fall back to a configured default and say so on stderr, once. This is what turns a cascade into a
   single leak.
3. **Keep `captureFrontmost()` and `restoreFocus(saved)` exactly as they are** — another lane is
   rewriting call sites against them right now, and changing their signatures breaks it silently.
   `guardFocus()` is additive.
4. **Tests** — `scripts/harness/focus.test.ts` exists and its `CALLERS` list is already incomplete (it
   omits `e2e-capability.ts`) and checks text presence rather than reachability. Make the test assert
   the guard's behaviour: capture once, restore on exit, restore on a signal, refuse to activate a
   `crust-e2e-*` name. Do not rely on actually sending signals to the test process unless you can do it
   without taking the screen.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt` without a
  path list. 200-line cap — split, never trim.
- **Never run an e2e suite** — each one launches a GUI app and takes the screen, which is the bug.
- Never `agent-desktop`, never move the cursor.
- Run every build and test in the foreground and wait for it inside the same call.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## Own

`scripts/harness/focus.ts` and `scripts/harness/focus.test.ts`. Nothing else — `scripts/e2e-*.ts`,
`scripts/e2e-harness.ts` and `scripts/window/**` belong to other lanes.

## Prove, and paste the output

- The new API surface, quoted.
- `bun test scripts/harness` green, with the new cases named.
- `bun check`, `bun run check:lines`.

Final message under 10 lines: the API added, how the `exit` path restores without awaiting, and what
the cascade guard refuses.
