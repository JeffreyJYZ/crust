# Linux shim C sources — memory ownership across the bun:ffi boundary (32)

Read-only hunt. Scope: every C source under `src/platform/linux/`, 15 files / 1766 lines:
`shim/{10_prelude,30_webview,40_window,45_window_api,46_window_state_api,50_pump,60_screen,70_keyring,80_clipboard,80_notify,81_opener,81_tray,82_osinfo,83_dialog,84_dialog_calls}.c`.
There is no `src/platform/linux/shim.c` — the unit is assembled from the numbered parts by
`src/platform/linux/shim-source.ts:20-42`; `80_notify.c` + `81_tray.c` are the second unit
(`notify-tray-ffi.ts`). Callers were traced with `rg` over `src/**/*.ts` only to establish
reachability; nothing in `src/` was changed, no GUI was launched.

**Count: 3 findings (1 medium, 2 low).**

**Worst: F1 — `shim_dlg_collect` frees the first 16 selected filenames but leaks every one past 16.**
A multi-select open with 17+ files leaks `N-16` GLib strings on every accept, permanently.

---

## F1 (medium, worst) — filenames past `SHIM_DIALOG_MAX` are never `g_free`d

- `src/platform/linux/shim/83_dialog.c:125-134` — the walk stops when
  `g_dlg_count == SHIM_DIALOG_MAX`:
  `while (node && g_dlg_count < SHIM_DIALOG_MAX) { … if (shim_dlg_free) shim_dlg_free(name); … }`
  (`:125`, `:130`), then unconditionally `g_slist_free(head)` (`:134`).
  `gtk_file_chooser_get_filenames` (bound at `83_dialog.c:83`) returns a `GSList` of
  *individually allocated strings* plus allocated nodes. `g_slist_free` frees **nodes only**,
  never `node->data`. So the loop frees the strings of the first 16 nodes, then the list
  release discards the remaining nodes **with their `g_strdup`'d data still attached**.
- The comment at `83_dialog.c:116-117` asserts "every string and the list itself are GLib
  allocations, so they go back through `g_free` / `g_slist_free`" — true only for the
  prefix the loop visits.
- The 16 cap is not a guard on GTK's answer, only on the shim's answer table:
  `84_dialog_calls.c:52` enables multi-select, `83_dialog.c:18` sets `SHIM_DIALOG_MAX 16`,
  and `src/plugins/dialog-transport.ts:15` sets the matching `DIALOG_MAX_PATHS = 16`.
  GTK happily returns more than 16; `dialog.ts:79-95` never sees them but C has already
  taken ownership.

**Reached:** `src/platform/linux/dialog.ts:141-153` `pickOpen` passes `panel.multiple ? 1 : 0`
to `shim_dialog_open` (`:144-147`) → `84_dialog_calls.c:62-65` → `shim_dlg_start` calls
`gtk_file_chooser_set_select_multiple(dlg, 1)` (`:52`) → the human selects 17+ files and
clicks Open → GTK emits `"response"` → `shim_dlg_response` (`83_dialog.c:139-143`) calls
`shim_dlg_collect`. Nodes 17..N are dropped by `g_slist_free` without their strings being
freed. Repeat with a large selection and the process grows by `N-16` strings per accept;
there is no later owner, so the memory is never reclaimed.

**Smallest fix:** free every node's data before the list, not only the ones copied into
`g_dlg_paths`. Either keep walking after the 16th accepted path (freeing `name` but not
copying it), or free the tail separately with a `g_slist_free_full` equivalent that walks
from node 17 and calls `shim_dlg_free` on each `node->data`. The list itself must still be
freed with `shim_dlg_slist_free` (GLib allocator), never `free`.

---

## F2 (low) — `shim_notify_load` leaks the `libnotify.so.4` handle on any missing symbol

- `src/platform/linux/shim/80_notify.c:111-131` — `g_notify_state = -1` is set at `:113`
  *before* `g_notify = dlopen("libnotify.so.4", …)` at `:115`. Every `shim_sym` failure
  (`:120`, `:121`, `:122`, `:123`, `:127`, `:128`) returns 0 immediately; there is no
  `dlclose(g_notify)` on any of those paths and `g_notify_state` stays `-1` forever
  (`shim_notify_load` short-circuits at `:112`), so nothing can ever release it.
  `shim_keyring_open` (`70_keyring.c:67-69`) shows the intended shape: dlclose + clear
  the handle on symbol failure.

**Reached:** first `shim_notify_post` (`80_notify.c:152`) on a libnotify that lacks one of
the six resolved entry points — e.g. an old `libnotify` where `g_error_free` or
`g_object_unref` is not reachable through its handle. The unit answers "missing symbol"
by name and the process keeps the `dlopen` reference for its whole lifetime. One handle
per process, so low impact, but the failure path is exactly the one this shim was written
to survive (see the header at `80_notify.c:6-8`), and repeated app processes pay it.

---

## F3 (low) — `shim_tray_load` leaks the `libgtk-3.so.0` handle on any missing symbol

- `src/platform/linux/shim/81_tray.c:38-67` — same shape: `g_gtk_state = -1` at `:40`,
  `g_gtk = dlopen("libgtk-3.so.0", …)` at `:41`, then ten `shim_sym` early returns
  (`:46-64`) with no `dlclose`. `g_gtk_state == -1` makes the leak permanent.
- The missing symbol is realistic, not hypothetical: `:60-62` deliberately requires
  `gtk_menu_popup_at_pointer` (GTK 3.22+) and states that older GTK must be refused by
  name. On such a GTK the handle is opened, the symbol lookup fails, and the handle is
  never closed.

**Reached:** first `shim_tray_menu` / `shim_tray_tooltip` / `shim_tray_show` on a GTK older
than 3.22 (`81_tray.c:103`, `:141`, `:148` each call `shim_tray_load`). The tray namespace
refuses cleanly, but the `dlopen` reference is retained for the process lifetime. Same
magnitude as F2.

---

## Adjacent, not counted

- **Dangling core pointers after a failed `shim_lib_open` retry.**
  `10_prelude.c:124-127` calls `shim_close_libraries()` (`:99-108`) on a resolve failure,
  which `dlclose`s both handles but leaves the function pointers already cached in
  `30_webview.c:12-32`, `40_window.c:6-13` and `50_pump.c:6-7` pointing into unmapped code.
  `shim_ready` stays 0, and `src/platform/linux/backend.ts:66-78,102-103` gates
  `createWindow`/`gtk_init` on a successful open, so no product path calls them while
  dangling; a retry re-resolves them. Recorded because the comment at
  `10_prelude.c:95-98` claims no cached pointer can be called, which holds only through
  that TS gate, not within C.
- **Lazy caches survive the same failed-open/retry cycle.**
  `45_window_api.c:84-87` (`api_state`), `60_screen.c:28-40` (`shim_screen_resolved`),
  `80_clipboard.c:24-35`, `81_opener.c:34-42`, `82_osinfo.c:14-20` and
  `83_dialog.c:68-95` (`shim_dlg_ready_state`) cache resolution forever. If one is
  touched while `shim_gtk_handle() == 0` after a failed open, it stays "not ready" even
  after a later successful `shim_lib_open`. Functional staleness, not a leak; counted
  separately because the product's load gate makes it hard to reach.
- **Shared missing-symbol buffer.** `80_notify.c:33` and `81_tray.c:43,63` both write
  `g_missing`. A tray resolve failure overwrites the symbol name `shim_notify_missing`
  (`80_notify.c:66`) would report. Not memory ownership.
