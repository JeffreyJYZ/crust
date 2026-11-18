# Focus: every call site that can skip its restore

Audited in `docs/reviews/focus/FOCUS.md`. This brief is **the call sites**, not the guard — another lane
is adding `guardFocus()` to `scripts/harness/focus.ts` right now. Keep `captureFrontmost()` and
`restoreFocus(saved)` exactly as they are; you are the only lane that changes how they are called.

## The leaks, from the audit

**Eight suites capture, then do work outside the `try`**, so a throw there never reaches the restore:

```
scripts/e2e-notes.ts:45,49        capture, then mkdtemp/mkdir
scripts/e2e-dev-binary.ts:39-102  capture, then a long body before the try
scripts/e2e-single.ts:32
scripts/e2e-dogear.ts:26
scripts/e2e-dev-react.ts:29
scripts/e2e-notify.ts:77
scripts/first-run.ts:78
```

**Three entry points never capture at all**, or restore only on the happy path:

```
scripts/demo.ts            never captures
scripts/probe-tray.ts      never captures
scripts/probe-notif.sh     restores on its last line only — `exit 1` at :17 skips it
scripts/probe-vite.sh      no trap
```

## What to do

1. **Capture inside the `try`'s reach or before anything that can throw.** The rule is that no
   statement between the capture and the `try` may throw: move `mkdtemp`/`mkdir`/`clearSurvivors` inside
   the `try`, or move the capture to the first line of the function and put everything else after it.
   Prefer the smallest diff that makes the restore reachable on every path.
2. **Add `guardFocus()` where it belongs** once it exists — but check first whether the guard lane has
   landed it. If `scripts/harness/focus.ts` does not export `guardFocus` yet, do the `try` work now and
   leave a `// TODO(guard)` line naming what to add; do not implement the guard yourself.
3. **The two scripts that never capture** should capture and restore like the suites do.
4. **The two shell scripts need a `trap`**: `trap '<restore command>' EXIT INT TERM`. Read what they
   already do on their last line and move that into the trap so it runs once, on every path.
5. **Do not touch `scripts/e2e-window.ts`** — another lane owns it this hour, and it is the one file
   where two writers would collide.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt` without a
  path list. 200-line cap — split, never trim.
- **Never run an e2e suite** — each launches a GUI app and takes the screen, which is the bug being
  fixed. Verify by reading, and by `bun check` / `bun run check:lines`.
- Never `agent-desktop`, never move the cursor.
- Run every build and test in the foreground and wait for it inside the same call.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## Own

Every `scripts/e2e-*.ts` **except `e2e-window.ts`**, plus `scripts/demo.ts`, `scripts/probe-tray.ts`,
`scripts/probe-notif.sh`, `scripts/probe-vite.sh`. Nothing under `src/`.

## Prove, and paste the output

- Per file, the one-line statement of what changed and why the restore is now reachable.
- `bun check`, `bun run check:lines`.
- `bun test scripts/harness` if the guard lane has landed, so the two changes are known to fit.

Final message under 12 lines: the files changed, and any suite where you could not make the restore
reachable without restructuring it.
