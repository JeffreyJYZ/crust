# Lane B — the measurement

Read `docs/plan/fullscreen/BRIEF.md` first.

## Own

- `scripts/e2e-fullscreen.ts` (new)
- `scripts/fullscreen/**` (new)
- `package.json` — add `"e2e:fullscreen": "bun run scripts/e2e-fullscreen.ts"` only

Nothing else. Do not touch `src/**`, `site/**` or `docs/**`.

## Model

Copy the shape of `scripts/e2e-window.ts` and `scripts/window/**`: a scratch project, `crust build
--dir <scratch>`, then the bundle's binary launched **directly** from `/` — never `open`. The page
runs its own `app.js` and prints answers on stdout, so each claim is an observation from the live
window rather than a plugin's `ok`.

Use `guardFocus()` before the launch and `restoreFocus()` in a `finally`; shape the entry point so
`process.exit()` is outside the `try` (it skips `finally`).

## What it must prove

1. **The window is fullscreen-primary.** Read the live `collectionBehavior` and assert
   `(behavior & 128) !== 0` and `(behavior & 256) === 0`. This is the green-button bit; a window
   without it gets the zoom `+` no matter what the plugin reports.
2. **A real fullscreen transition completes.** Ask the app for fullscreen through the real
   `crust:window` plugin path (read `src/plugins/window-state-types.ts` and
   `src/plugins/window.ts` for the actual command names — do not guess), then assert the window
   reports fullscreen **and** its style mask carries `NSWindowStyleMaskFullScreen` (`1 << 14`), and
   the page's viewport covers the display (`innerHeight` within a few pixels of `screen.height`).
   A zoomed window is ~`screen.height - menubar - dock`; that gap is the difference the user sees,
   so the assertion has to be tight enough to tell them apart.
3. **It still lands on the Space the user is looking at.** `isOnActiveSpace` is 1 after launch.
4. **It leaves fullscreen again** and the style mask clears, so the flag is not sticky.

If the fix from lane A has not landed yet, the first assertion is expected to fail — that red result
is the proof the harness can fail, so record it and say so. Do not weaken an assertion to make the
tree green, and do not change `src/**` to make it pass.

## Prove

- The harness run, both results (red before the fix if that is what you saw, green if the fix was
  already in the tree), with the assertion lines pasted.
- `bun check` and `bun run check:lines`.
- Confirm no window, no scratch directory and no process is left behind, and that focus was handed
  back.

## Final message

Under 15 lines: what the harness asserts, what it printed, the gate results.
