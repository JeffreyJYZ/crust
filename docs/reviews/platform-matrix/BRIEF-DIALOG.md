# Windows and Linux: `dialog`

The file picker refuses on both platforms, so an app cannot ask a user to choose a file at all outside
macOS. Measured:

```
MATRIX.md:67   dialog   macOS works | Windows refuses | Linux refuses
src/plugins/dialog.ts:78,95,110   requires NSOpenPanel / NSSavePanel
```

## What to build

An adapter per platform behind the existing plugin contract — read `src/plugins/dialog.ts` and the
darwin adapter it uses to get the exact shape: `openPanel` (title, multiple, directory, filters) and
`savePanel` (title, suggestedName, filters), both returning a path or paths, plus `cancel`.

1. **Windows** — `IFileOpenDialog` / `IFileSaveDialog` through COM (`CoCreateInstance`), or
   `GetOpenFileNameW`/`GetSaveFileNameW` from `comdlg32` if the COM lifetime is not reachable from
   `bun:ffi` without a message pump problem. **Check whether the app's message pump is already running
   and on which thread** — a modal dialog on the wrong thread deadlocks the app, and that is the one
   failure mode that would be worse than the refusal. Say which you chose and why.
2. **Linux** — `GtkFileChooserDialog` with `gtk_dialog_run`, or the newer `GtkFileChooserNative` if it
   is reachable. `gtk_dialog_run` runs its own nested loop; check what that does to the existing GTK
   main loop in this shim before committing to it.
3. **Filters** — map the plugin's filter shape to `SetFilter`/`gtk_file_filter_add_pattern` honestly. A
   filter that silently matches everything is the fake-success pattern this codebase is trying to
   remove.
4. **`cancel`** — cancelling is a normal answer, not an error: return the same shape the darwin adapter
   returns for a cancelled panel.
5. **Register it** where the other non-darwin adapters are registered.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt` without a
  path list. 200-line cap — split, never trim.
- Every new shim symbol needs a `PREFLIGHT` entry, an `abi-width` verdict where that test exists, and a
  `fake-shim` arm so tests run here.
- **A modal dialog needs a human.** If the honest implementation cannot be tested on this machine
  without a person clicking, say so plainly and make the test cover the argument mapping and the
  cancel path, not the click.
- **You cannot run Windows or Linux.** Label read-from-code claims.
- Never `agent-desktop`, never move the cursor, never launch a GUI app. **Do not open a dialog to "see
  if it works"** — that takes the screen.
- Run every build and test in the foreground and wait for it inside the same call.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## Own

`src/platform/windows/**` and `src/platform/linux/**` for the dialog adapter, plus the registry line for
`dialog` only. Another lane owns `clipboard`/`opener`/`os.info` in the same directories — **new files
only, and do not edit a file another lane has touched**; if you must share one, append rather than
rewrite.

## Prove, and paste the output

- `bun test src/platform/windows src/platform/linux` green, new cases named.
- `bun run test`, `bun check`, `bun run check:lines`.
- What `dialog.openPanel` answers on each OS now.

Final message under 12 lines: the mechanism you chose per OS, what is still refused, and whether a
modal could deadlock the pump.
