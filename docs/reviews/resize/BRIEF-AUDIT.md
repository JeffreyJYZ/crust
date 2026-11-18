# Do Windows and Linux windows resize their page?

A macOS defect was just found: the window resized but the webview stayed at its initial size, so the
page area never changed. The cause was over-constrained Auto Layout in
`src/platform/darwin/window-create.ts` — a fixed width and height pinned the webview, and the content
view had its autoresizing removed.

**The same class of bug may exist on the other two platforms.** Find out, by measurement, and report.

## What to determine

1. **Windows** — `src/platform/windows/` has a window procedure that handles `WM_SIZE` and resizes a
   WebView2 controller (`shim-source.ts` mentions `20_class.c`'s window procedure resizing the
   controller that `42_webview.c`'s table holds). Read it and decide:
   - Is the controller's bounds updated on **every** `WM_SIZE`, including a maximise, a restore and a
     drag from either corner?
   - Does it use the **client** rectangle (`GetClientRect`) rather than the window rectangle? Using
     the window rect leaves the page under the title bar and mis-sized by the frame.
   - Is `WM_SIZE` handled when the window is created before the controller exists (a size arriving
     early must not resize a null controller)?
   - Does DPI change (`WM_DPICHANGED`) also re-apply bounds?
2. **Linux** — `src/platform/linux/` uses GTK: is the webview packed with `gtk_box_pack_start` /
   expand+fill, or given a fixed size request? A `gtk_widget_set_size_request` on the webview (as
   opposed to the *window minimum*) would freeze it exactly like macOS did.
3. **Anything platform-neutral** — is there a shared place (the `window` plugin's `setSize`, or
   `window-state`) that could re-apply a stale size after the platform resized the page?

## Report, do not fix

Write `docs/reviews/resize/AUDIT.md`:

- A verdict line per platform: `resizes correctly`, `defect`, or `cannot determine from this machine`
  — and for anything you cannot run, say so plainly instead of implying you measured it.
- For each defect: the file and line, the exact mechanism, and the smallest fix.
- For each "correct": the code that proves it, quoted, so the claim is checkable.
- Rank by severity. A frozen page is worse than a page that lags by a frame.

You cannot run Windows or Linux here. Read the shim C and the TypeScript, and say which conclusions
are read-from-code rather than measured. Do not claim a runtime observation you did not make.

## Own

`docs/reviews/resize/AUDIT.md` only. **Do not edit any source file** — another lane is fixing the
macOS path right now, and the Windows/Linux fixes will be dispatched from your report.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt`.
- Never `agent-desktop`, never move the cursor, never launch a GUI app.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

Final message under 10 lines: the three verdicts, and the single worst defect you found.
