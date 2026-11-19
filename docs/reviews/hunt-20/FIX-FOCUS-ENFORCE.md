# Make focus restore impossible to forget

The owner's report, in their words: "some throwaway probes not using focus restore at all". Not a wrong
fallback — **no capture at all**. A probe that opens a window and never arms the focus util takes the
screen and leaves it taken.

`scripts/harness/focus-callers.ts` already enforces coverage, but only over `scripts/` and only over the
names it lists. A one-off probe written at the repo root, or a new script that spawns a built binary, is
invisible to it — which is exactly how the owner got burned.

## What to build

1. **Detect, don't list.** The caller check should decide "this file can take the screen" from what the
   file does, not from a hand-maintained list:
   - it spawns a path under `dist/`, a `.app`, or a built binary;
   - it calls `createNativeWindow`, `Bun.spawn` with a GUI app, or `open -a`;
   - it runs `crust dev` / `crust build` and then launches the result.
   Any such file must either call `guardFocus()` / `captureFrontmost()+restoreFocus()` or run its child
   under `probe-run`.
2. **Scan the whole tree for probe-shaped files**, not just `scripts/`: repo root (`.*.ts`, `*.probe.ts`,
   `probe*.ts`), `examples/**`, and `research/**` if it holds runnable probes. A throwaway probe at the
   root is the exact case that failed, so the check must see one. If root-level probes are transient,
   the check still fails while one exists — that is the point: it is a reminder with teeth.
3. **Fail with the fix in the message**: name the file and say "run it under `probe-run -c`, or arm
   `guardFocus()`". A check that only says FAIL teaches nobody.
4. **Wire it into the gate** so it runs on every `bun run test` (a `*.test.ts` beside the check is the
   cheapest way), and say in the test's own comment what it prevents.
5. **Prove it catches the real case**: create a temporary root-level probe that opens a window without
   arming focus, show the check fails naming it, then delete it and show it passes.

## Own

`scripts/harness/focus-callers.ts`, its test, and `scripts/harness/focus.test.ts` if the split needs it.
Nothing else — another lane is finishing the fix wave in `src/`.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt` without a
  path list. 200-line cap — split, never trim.
- **Never launch a GUI app to test this.** The detector is static analysis over source text; prove it
  against a temporary file, not a real window.
- Never `agent-desktop`, never move the cursor.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## Prove, and paste the output

- The detector's rules, quoted.
- The temporary probe failing the check, and the tree passing once it is deleted.
- `bun test scripts/harness`, `bun check`, `bun run check:lines`.

Final message under 10 lines: what the detector looks for, where it scans, and the failure message.
