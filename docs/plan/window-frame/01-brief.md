# Persist a window's frame across launches

In `crust dev` a backend edit restarts the app, and the window comes back at the configured size
instead of the size the human left it. `window-state` exists and nothing calls it — `restore()` has no
automatic caller, so a persisted frame is only ever applied if a page asks.

## Behaviour

- **Restore on create.** For each window label, if a saved frame exists, open at it instead of the
  config's `width`/`height`. The human resizes, edits a file, and the window comes back where it was.
- **Save when it changes, not only on close.** A dev restart can be a signal or an exit that never
  reaches a clean shutdown, so a save that only runs in `before-quit` will lose the size that made the
  human care. Debounce a write on frame change; also save on close and quit.
- **Validate against the current displays.** A frame saved on a monitor that is now gone restores a
  window nobody can see — hunt-50 found exactly that gap in `window-persist.ts`. Reject a frame whose
  origin or size leaves no usable intersection with any display's `workArea`, and fall back to the
  config size (centred) rather than trusting the file.
- **A corrupt or empty file is not an error.** `window-persist-store.ts` already has that rule; keep it.
- **Per app, per label.** The file lives under the app's own data directory — do not repeat the
  shared-root defect hunt-50 found in `fs` and `stronghold`.

## Where it goes

`src/app-loop.ts` creates windows from config; that is where a saved frame has to be consulted, so the
restore is not something a page has to opt into. Read the frame through the platform's window-state
adapter, not through AppKit directly.

## Do not

- Do not change `window-state`'s public commands; this is automatic behaviour, not a new command.
- Do not let a saved frame win over an explicit `window.setSize` in the same run.
- Do not write to the file on every resize event; debounce.

## Proof

A unit test for the validation rule (frame fully off-screen, partly off-screen, fits) and for the
debounce. A real run: `crust dev`, `window.setSize` to a distinct size, touch the backend to restart,
and the new window reports that size. If a signal restart cannot be made to save, say so and use the
quit path — but say which one you proved.
