# Linux: a window with `minWidth` can never be made shorter

Found by an audit of the resize class of bug. Read from code; nothing was run on Linux.

```
src/platform/linux/shim/40_window.c:73
    if (min_w > 0) shim_set_size_request(win, min_w, h);
```

Two defects in one line:

1. **`h` is the window's *opening* height, not a minimum.** A 900x600 window with `minWidth: 400`
   gets a 600 px minimum height, so it can never be dragged shorter. Measured reading only — but the
   mechanism is unambiguous: `gtk_widget_set_size_request` sets a floor on both axes it is given.
2. **`minHeight` never reaches the shim at all.** `shim_window_new(title, w, h, min_w)` has no
   parameter for it, so `linux/backend.ts:102-107` drops `options.minHeight` on the floor. A config
   that asks for a 400 px minimum height gets nothing.

The page itself is fine: `shim_window_attach` adds the webview with `gtk_container_add`, no size
request on the view, so GTK resizes it with the window.

## What to do

1. **Give the shim both minimums.** `shim_window_new(title, w, h, min_w, min_h)`; call
   `gtk_widget_set_size_request(win, min_w > 0 ? min_w : -1, min_h > 0 ? min_h : -1)`.
   `-1` is GTK's "no request" on an axis — do not pass 0, which is a real floor of zero and is not
   the same thing.
2. **Thread it through**: `src/platform/linux/shim-ffi.ts` (the `shim_window_new` declaration *and*
   its `args` array — the arity must match the C prototype), `src/platform/linux/backend.ts`
   (`options.minHeight ?? 0`), and the stubs in `backend.test.ts`, `backend-preflight.test.ts`.
3. **Fix the tests so they would have caught this**: `backend.test.ts` records the call args —
   assert `minHeight` arrives, and assert a window with `minWidth` only does **not** get a height
   floor. `shim-source.test.ts` pins the C signature string; update it.
4. Check nothing else calls `shim_window_new` — `rg` it — and that the darwin/windows paths are not
   affected. Do not touch them.

## Own

`src/platform/linux/**` only. Another lane is editing `src/platform/darwin/window-create.ts` and
`scripts/window/**` — do not touch those.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt` without a
  path list. 200-line cap — split, never trim.
- You cannot run GTK here. Say which claims are read-from-code rather than measured; do not invent a
  runtime observation.
- Never `agent-desktop`, never move the cursor, never launch a GUI app.
- Run every build and test in the foreground and wait for it inside the same call.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## Prove, and paste the output

- `bun test src/platform/linux` green, with the new assertions named in the output.
- `bun check`, `bun run check:lines`.
- The new C signature and the new `args` array, quoted.

Final message under 10 lines: the signature change, what `minHeight` did before, and the test that
now pins it.
