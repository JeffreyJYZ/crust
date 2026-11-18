# Wire `notification` and `tray`, and give the tray its pump tick

`a93d6b3` built both for Windows and Linux with 63 tests, and left two things undone on purpose:

1. **Nothing is registered.** The registry still hands out the bare plugins, so `notification.notify`
   and `tray.setTitle` still answer `not-implemented` on both OSes.
2. **The tray needs one `pollClick()` per pump tick.** The Windows tray reads a click with
   `pollClick()`, and the Linux `GtkStatusIcon` the same way. Without a per-tick call a menu click is
   recorded and never relayed — a tray that silently does nothing, which is the `autostart` bug in a new
   costume.

## What to do

1. **Register them** the way the other adapters are registered: read `src/runtime-adapters-other.ts` and
   `src/runtime-plugins-other.ts` first. `core` still carries the bare `notification` and `tray`, and the
   registry refuses a duplicate name rather than shadowing one, so add them to the replaced set — the
   same mechanism `window-state`, `clipboard`, `opener`, `os` and `dialog` already use.
2. **Add the pump tick.** Find where the pump iterates (`shim_pump` on Windows, the GTK main iteration on
   Linux) and call the tray adapter's `pollClick()` once per tick. **Do not add a second message loop** —
   the Windows unit deliberately reuses the existing one because `DispatchMessageW` is thread-wide.
   Whatever you hook must be cheap: it runs every tick, so it must not allocate or block.
3. **Decide the fate of `src/platform/{windows,linux}/notification-adapter.ts`.** Both files exist,
   are tested, and are referenced by nothing. Either they are the notification adapter that should be
   wired (in which case wire them and say how they relate to `notify-tray-source.ts`), or they are a
   superseded draft and should be deleted. **An unreferenced adapter is a trap for the next reader** —
   two files implementing one namespace, one live and one not, is exactly how a later fix lands in the
   dead one.
4. **Prove the tick does something.** A test that records a click and asserts it is relayed on the next
   tick, on both platforms through their fakes. Without that the tick is decoration.
5. **Update `docs/reviews/platform-matrix/MATRIX.md`** — `notification` and `tray` move from `refuses`
   to `works` (or `partial`, honestly) with the new source column value, and the counts at the bottom
   change with them. Keep the counts as bullets, not table rows.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt` without a
  path list. 200-line cap — split, never trim.
- **You cannot run Windows or Linux.** Label read-from-code claims; the fakes are the only measurement.
- Never `agent-desktop`, never move the cursor, never launch a GUI app, **and never fire a real
  notification** — it takes the screen.
- Run every build and test in the foreground and wait for it inside the same call.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## Own

`src/runtime-adapters-other.ts`, `src/runtime-plugins-other.ts`, `src/platform/{windows,linux}/**` for the
tick and the notification-adapter decision, and `docs/reviews/platform-matrix/MATRIX.md`. Nothing else.

## Prove, and paste the output

- What `notification.notify` and `tray.setTitle` answer on each OS through the registry, before and after.
- The tick test's output, and the line that proves a click is relayed.
- `bun test src/platform/windows src/platform/linux src/runtime-*`, `bun run test`, `bun check`,
  `bun run check:lines`.

Final message under 12 lines: what is registered, how the tick is hooked, and what happened to
`notification-adapter.ts`.
