# Linux menu/tray/clipboard callback-lifetime hunt — 31

Scope: `src/platform/linux/` files for the tray menu, tray and clipboard —
`shim/81_tray.c`, `shim/80_clipboard.c`, `tray-adapter.ts`, `tray-tick.ts`,
`notify-tray-ffi.ts`, `clipboard.ts`, `platform.ts`, plus the two callers that
own their registrations (`runtime-adapters-other.ts`, `src/plugins/tray.ts`).
Read-only inspection; nothing in `src/` was changed and no GUI app was launched.

**Count: 1 defect on this brief's angle (a callback that survives the menu that
registered it).** Two adjacent weaknesses in the same call path are noted at
the end but are not counted: one drops a callback rather than keeping it too
long, one is currently benign.

The clipboard half has no findings on this angle. `80_clipboard.c` registers no
callbacks — `gtk_clipboard_get`/`set_text`/`wait_for_text` are synchronous, and
the only lifetime concern (a GLib allocation freed through `g_free`, not Bun's
`free`) is already handled at `80_clipboard.c:34,63`. `clipboard.ts` creates no
closures that outlive a `readText`/`writeText` call.

## MEDIUM — a click recorded by an old menu fires the new menu's row callback

The worst finding. The click callback (the recorded index) outlives the menu
that registered it and is delivered to a different row's `onClick`.

- **where (C, registration):** `src/platform/linux/shim/81_tray.c:20` (`static
  int g_click = -1`), `:72-75` (`shim_tray_on_item` writes `g_click` from the
  GTK `"activate"` signal's `user_data`), `:127-133` (`shim_tray_menu` connects
  each row's `"activate"` with `data = (row + 1)`).
- **where (C, stale state):** `81_tray.c:102-107` — `shim_tray_menu` destroys the
  previous `g_menu` and sets `g_menu = 0` but never resets `g_click`. Contrast
  `shim_tray_destroy` at `:162-175`, which does clear it at `:173`. So replacing
  a menu leaves the last recorded click from the old menu intact.
- **where (TS, wrong handler):** `src/platform/linux/tray-adapter.ts:92-99` —
  `setMenu` replaces `items` wholesale (`items = next`, `:98`). `:121-133`
  `pollClick()` reads the recorded index via `shim_tray_click()` and calls
  `items[index].onClick?.()` (`:128`). The guard at `:125-126` drops the click
  only when `items[index]` is **undefined**; an in-range index from the old menu
  resolves to a different row in the new menu. The comment at `:118-120` claims
  "the menu was replaced between the click and the poll, and a stale index would
  fire the wrong row" is handled — it is handled only when the new menu is
  shorter than the click index.
- **where (event):** `src/plugins/tray.ts:117-127` — the wired `onClick` closure
  captures the *new* `item` and `index` and calls `emitClick(ctx, { index,
  label: item.label })` (`:125`). A stale click therefore also pushes a
  `tray:click` event carrying the new row's label.

**How it is reached (end to end):**

1. Page calls `tray.setMenu` with menu M1, rows `A` (index 0) and `B` (index 1).
   `tray-adapter.ts:setMenu` stores `items = M1`; C builds a `GtkMenu` whose
   rows carry `"activate"` handlers with `user_data` 1 and 2 (`81_tray.c:130`).
2. The human right-clicks the status icon and picks `A`. GTK emits
   `"activate"`; `shim_tray_on_item` (`81_tray.c:72-75`) records `g_click = 0`.
   Because `g_main_context_iteration` is only pumped per tick, nothing consumes
   it yet (`platform.ts:55-64`).
3. Before the next tick, the page refreshes the menu with M2, rows `X`, `Y`
   (a dynamic/disabled-state refresh is the ordinary way this happens).
   `tray-adapter.ts:98` sets `items = M2`. C destroys the old menu but leaves
   `g_click == 0` (`81_tray.c:104-107`).
4. The pump tick calls `pollTrayTick()` (`platform.ts:62` →
   `tray-tick.ts:36-38`). `pollClick()` gets index `0`, and `items[0]` is now
   `X`. `X.onClick` runs at `tray-adapter.ts:128`, invoking X's handler and
   emitting `tray:click { index: 0, label: "X" }`. `A`'s handler never runs.

The click was produced by a row of M1 but delivered to a row of M2. Any menu
refresh of the same or greater length triggers it; only a refresh shorter than
the index is dropped. A generation id or `g_click` reset is required.

- **smallest fix:** clear `g_click` in `shim_tray_menu` when it destroys the old
  menu (next to `81_tray.c:105-106`, exactly as `shim_tray_destroy` does at
  `:173`). For clicks already emitted by an old, still-realized menu, tag each
  `setMenu` with a generation counter checked in `pollClick()` before calling
  `row.onClick`.

## Adjacent, not counted

- **LOW — rapid clicks are coalesced.** `g_click` is one int (`81_tray.c:20`),
  so two `"activate"` signals before one pump tick overwrite each other and the
  first click's callback is lost. Different failure direction from this brief
  (callback dropped, not outliving).
- **LOW — the pump's tray registration is never cleared.** `runtime-adapters-other.ts:69-70`
  calls `setActiveLinuxTray(tray)` once and no product teardown calls
  `setActiveLinuxTray(undefined)`; `pollTrayTick()` keeps calling `pollClick()`
  on the adapter after `tray.destroy()`. Currently benign because
  `shim_tray_destroy` clears `g_click` (`81_tray.c:173`) and `pollClick` returns
  `-1`, so no stale handler fires.
