# Windows: close the refusals the new adapter left behind

`src/platform/windows/window-adapter.ts` and `window-state-adapter.ts` landed in `47415e1`. Six
pairs were refused by name because "each needs a read-back the shim cannot make in one call":

```
setAlwaysOnTop / isAlwaysOnTop
setFullscreen  / isFullscreen
setDecorations / isDecorated
setOpacity     / opacity
setCursor      / setCursorVisible
positioner (all nine placements, refused because AppKit's space is bottom-left and Win32's is y-down)
```

Every one of those is a Win32 call the shim can make. The refusal was a limit of the first pass, not
of the platform. Close them.

## Per member, what Win32 actually gives you

These are starting points, not a spec — verify each against the Win32 documentation rather than
trusting this list.

- **Always-on-top** — `SetWindowPos(hwnd, HWND_TOPMOST | HWND_NOTOPMOST, …)` with `SWP_NOMOVE |
  SWP_NOSIZE | SWP_NOACTIVATE`. Read back with `GetWindowLongPtrW(hwnd, GWL_EXSTYLE)` and the
  `WS_EX_TOPMOST` bit.
- **Fullscreen** — save the style and rect, switch to `WS_POPUP` (or drop `WS_CAPTION|WS_THICKFRAME`),
  size to the monitor's rect from `MonitorFromWindow` + `GetMonitorInfoW`, restore on exit. The
  read-back is the saved state, so the flag must survive an unrelated resize.
- **Decorations** — toggle `WS_CAPTION` (and the frame bits) with `SetWindowLongPtrW`, then
  `SetWindowPos(… SWP_FRAMECHANGED)` or the change does not repaint. Read back from `GWL_STYLE`.
- **Opacity** — add `WS_EX_LAYERED`, then `SetLayeredWindowAttributes(hwnd, 0, alpha, LWA_ALPHA)`.
  Read back with `GetLayeredWindowAttributes`. Note this interacts with `WS_EX_LAYERED` being cleared
  by a style rewrite — check it does not silently disable itself.
- **Cursor** — `SetCursor(LoadCursorW(NULL, IDC_…))` for the shape; `setCursorVisible` is a count, not
  a boolean (`ShowCursor` increments/decrements), so track it or use the returned count rather than
  pretending a boolean round-trips.
- **Positioner** — the nine placements are pure geometry once you have the monitor's **work area**
  (`GetMonitorInfoW` `rcWork`, which already excludes the taskbar). Compute them in Win32's y-down
  space; do not port AppKit's bottom-left math.

## The ABI trap that will bite you

`GetWindowLongW` is 32-bit even on x64 — the pointer-sized call is `GetWindowLongPtrW`, and on 64-bit
Windows `GetWindowLongPtrW` is the one to declare. A `bun:ffi` declaration whose arity or return width
drifts from the C prototype faults rather than failing cleanly, and `abi-width.test.ts` exists to
catch exactly that. Every new symbol needs a `PREFLIGHT` entry, an `abi-width` verdict, and a
`fake-shim` arm so the tests can run on this machine.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt` without a
  path list. 200-line cap — split, never trim.
- **Keep the file split.** `window-adapter.ts` is 155 lines and `window-state-adapter.ts` is 93; adding
  six pairs to either will break the cap, so split by responsibility (a `window-style-adapter.ts` for
  the style-driven members is the obvious seam).
- **Do not remove a refusal you cannot implement honestly.** A command that lies is worse than one
  that refuses by name.
- **You cannot run Windows here.** Say which claims are read-from-code and which are test-only; the
  `windows-arm-runtime` tag run is the only runtime verdict.
- Never `agent-desktop`, never move the cursor, never launch a GUI app.
- Run every build and test in the foreground and wait for it inside the same call.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## Own

`src/platform/windows/**` only. Another lane is working in `src/platform/linux/**` and a third is
reading `src/platform/darwin/**`; do not touch either.

## Prove, and paste the output

- `bun test src/platform/windows src/runtime-plugins*` green, with the new cases named.
- `bun run test`, `bun check`, `bun run check:lines`.
- The list of members that moved from refused to implemented, and any still refused with the reason.

Final message under 12 lines: what now works, what still refuses and why, and the ABI widths you had
to get right.
