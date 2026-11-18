# Wire `guardFocus()` into the suites, and drop the TODO markers

`fad507e` landed the focus work in two halves that do not meet yet:

- `scripts/harness/guard.ts` has `guardFocus()` — capture once, restore from `exit` and
  `SIGINT`/`SIGTERM`/`SIGHUP` synchronously, refuse to activate our own `crust-e2e`/`crust-app` apps.
- Nine suites carry `// TODO(guard)` naming that module, because it did not exist when their call sites
  were fixed.

Until they meet, a Ctrl-C still skips the restore in every suite. That is the bug the owner reported,
so this is the last step.

## What to do

1. **Re-export `guardFocus` from `scripts/e2e-harness.ts`** so a suite imports it beside
   `captureFrontmost`/`restoreFocus`, the way every suite already imports those.
2. **Replace each `// TODO(guard)`** with a real `guardFocus()` call at the point where the suite
   currently captures. Read each one first — the call site is not identical everywhere:
   - a suite that captures then does work in a `try` should keep that `try` and *add* the guard, not
     replace it: the guard covers signals and `exit`, the `finally` covers normal and thrown exits, and
     both are wanted;
   - `demo.ts` and `probe-tray.ts` capture before activating something — the guard goes at the same
     point, for the same reason.
3. **Do not change `captureFrontmost`/`restoreFocus`**, and do not remove a `finally` because the guard
   "covers it". They answer different questions: the guard knows the app that was frontmost when the
   process started; the `finally` restores the one this suite captured.
4. **`e2e-window.ts` is in scope now** — it was excluded last round because another lane owned it, and
   that lane has landed.
5. **Extend the caller test.** `scripts/harness/focus.test.ts` has a `CALLERS` list that checks text
   presence; it omits `e2e-capability.ts` and would not notice a suite that calls neither. Make it
   assert that **every** GUI-launching script either calls `guardFocus()` or is on an explicit,
   commented exemption list.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt` without a
  path list. 200-line cap — split, never trim.
- **Never run an e2e suite** — each launches a GUI app and takes the screen. Verify by reading, plus
  `bun test scripts/harness`, `bun check`, `bun run check:lines`.
- Never `agent-desktop`, never move the cursor.
- Run every build and test in the foreground and wait for it inside the same call.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## Own

`scripts/e2e-*.ts`, `scripts/harness/focus.test.ts`, `scripts/e2e-harness.ts`, `scripts/demo.ts`,
`scripts/probe-tray.ts`. Nothing under `src/` — three lanes are mid-flight there.

## Prove, and paste the output

- The `guardFocus()` call site in two different suites, quoted, showing they are not identical.
- The caller test's new assertion, and its output.
- `bun test scripts/harness`, `bun check`, `bun run check:lines`.

Final message under 10 lines: how many suites now call the guard, which are exempt and why, and what
the caller test would catch that the old one would not.
