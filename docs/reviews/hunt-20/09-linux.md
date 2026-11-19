# Hunt 20 — Linux platform (`src/platform/linux/**`)

All claims below are `read` (source read on macOS, no GTK runtime here). No Linux runtime
observation is claimed.

## Wrong answer — a second panel overtakes the first, and the first returns the second's picks

- where: `src/platform/linux/dialog.ts:103-130` (`awaitAnswer`), `:141-168` (`pickOpen`/`pickSave`), `:175-180` (`cancel`); `src/platform/linux/shim/83_dialog.c:45-59`, `84_dialog_calls.c:38-42`
- mechanism: One C slot holds one dialog (`g_dlg_dialog`, `g_dlg_state`, `g_dlg_paths`). `shim_dlg_start` releases any previous dialog and overwrites the state. The TS `pending` slot holds only the *newest* request's `abandon`; an older `awaitAnswer` keeps its own `abandoned=false` and keeps polling. When the new panel is accepted, the old waiter reads the shared `ACCEPTED` state, calls `readPaths`, releases the new dialog (state to `IDLE`), and returns the new panel's paths as its own. The new waiter then sees `IDLE` and throws `lost its panel (status 0)`. The comment at `dialog.ts:100-101` claims the guard prevents exactly this, but it only runs on the `cancel` path, not when a new panel is started.
- reachable by: A page invokes `dialog.openPanel` twice without cancelling the first (two buttons, or any script issuing two concurrent invokes). The plugin (`src/plugins/dialog.ts:74-100`) does no serialization; `awaitAnswer` yields on `setTimeout`, so invoke two starts while invoke one is pending.
- smallest fix: Give each panel a generation id; have the C side return it on start and include it in the status read, and make `awaitAnswer` bail when its id is no longer current. Also abandon every older pending request when a new one starts.

## Crash — `quit()` calls `gtk_widget_destroy` on a window the window manager already freed

- where: `src/platform/linux/platform.ts:155-160` (`quit`), `:143-148` (`destroy`), `:97-106` and `:113-120` (prune sites); `src/platform/linux/backend.ts:133-135`; `src/platform/linux/shim/40_window.c:51-54`, `:108-114`
- mechanism: Closing a window with the WM titlebar emits GTK's `destroy` signal; `shim_on_destroy` clears the C slot, so `backend.isOpen` now reports false. Nothing, however, removes the label from `LinuxPlatform.#windows` at signal time — only `window()`, `windowLabels()`, `nativeWindow()` prune, and `quit()` iterates the raw map keys. `quit()` therefore passes a freed `GtkWindow *` to `shim_window_destroy` → `gtk_widget_destroy`, a use-after-free on the widget's memory.
- reachable by: Close a window via the WM, then reach `app.quit()`/`platform.quit()` before the next `windowLabels()` prune. `watchWindows` (`src/app-watch.ts:89-99`) prunes on a 250 ms timer, so the race window is up to 250 ms; any other quit trigger inside that window hits it. With more than one window the all-closed watcher does not fire on the first close, widening the window indefinitely.
- smallest fix: Guard `LinuxPlatform.destroy` with `this.#backend.isOpen(entry.win)` and return early when false (or have `quit()` route through `windowLabels()` so stale entries are pruned first).

## Wrong answer — X11 reached by hostname is refused as "unplaceable", and Wayland named `:0` is wrongly trusted

- where: `src/platform/linux/shim/46_window_state_api.c:14-21` (`shim_window_placeable`); `src/platform/linux/window-state-adapter.ts:32-39`; `src/platform/linux/window-sends.ts:70`
- mechanism: Placeability is decided by `api_display_name(display)[0] == ':'`. `gdk_display_get_name` on X11 returns the `DISPLAY` string, so `DISPLAY=localhost:10.0` (TCP/remote X) starts with `l` and is refused even though GTK can move and report the toplevel. Conversely `WAYLAND_DISPLAY=:0` makes the Wayland compositor socket name start with `:`, so placement is allowed; GTK ignores `gtk_window_move` on Wayland, but `shim_window_move` still returns 1 and `shim_window_position` reports coordinates the compositor never honored.
- reachable by: Launch under X11 with a hostname-qualified `DISPLAY`, then call `window.setPosition`/`getPosition` — both throw `unknown-adapter` naming a Wayland gap that does not exist. Or launch Wayland with `WAYLAND_DISPLAY=:0` and call the same commands — they report success with a fictitious origin.
- smallest fix: Resolve and use the GDK backend type (`GDK_IS_X11_DISPLAY`, via `gdk_display_get_type`/`g_type_is_a`, or resolve `gdk_x11_display_*` by name) instead of parsing the display name.

## Silent lie — the 33rd simultaneous window is live but reported dead

- where: `src/platform/linux/shim/40_window.c:37-38` (`shim_slots[32]`), `:78-92` (slot assignment), `:56-62` (`shim_window_alive`)
- mechanism: When all 32 slots are occupied, `slot` stays `-1`; `shim_window_new` still returns a valid `GtkWindow *` but never records it. `shim_window_alive` only searches slots, so it returns 0 for a live window. The platform then prunes its label and every later adapter command throws `unknown-window` although GTK is showing the window.
- reachable by: Open 33 windows at once (a page calling `window.create` in a loop; no limit is enforced in `window-adapter.ts:72-83` or `platform.ts:86-95`).
- smallest fix: Either grow/reallocate the slot array (reporting failure only on allocation error) or refuse window creation explicitly when the table is full, so JS never gets a live pointer it cannot track.

## Wrong answer — a reused GObject address revives a closed window's handle

- where: `src/platform/linux/shim/40_window.c:40-49` (`shim_slot_release`), `:78-92` (slot reuse), `:56-62` (`shim_window_alive`); `src/platform/linux/platform.ts:97-106`
- mechanism: A slot is identified only by the raw widget pointer. After window A is destroyed the slot is cleared; when a new window B is allocated at the same address (ordinary GObject/g_slice reuse), the slot is refilled with the same pointer value and `alive=1`. A stale JS handle for A still in `#windows` now matches B's slot: `isOpen` returns true and every `crust:window` command on label A drives window B.
- reachable by: WM-close A, then create B with an absolute URL within one 250 ms watcher tick (an absolute URL makes `resolveDocument` return early without calling `windowLabels()`, so A is not pruned). GObject reuses same-sized object addresses readily.
- smallest fix: Store a monotonically increasing generation counter in each slot and make `shim_window_alive` take/return the generation, so a stale pointer cannot match a later window.

## Wart — clipboard read does unbounded synchronous work on the thread that owns the pump

- where: `src/platform/linux/shim/80_clipboard.c:48-65` (`shim_clipboard_read`); `src/platform/linux/clipboard.ts:38-56`
- mechanism: `gtk_clipboard_wait_for_text` is a synchronous wait for the selection owner. It runs on Bun's main thread — the same thread whose JS timer drives `g_main_context_iteration`. An owner that never answers holds up the page and every pump slice; the two-pass read in `readText` can perform that wait twice.
- reachable by: A clipboard owner (another app) that accepts the selection request but never responds. The shim treats NULL as "no text", but the wait itself has no caller-side bound. GTK's internal timeout behavior is not verified here (`read`, not `measured`), so the severity may be lower on some builds.
- smallest fix: Read the selection asynchronously with `gtk_clipboard_wait_for_text_async`/a callback delivered through the pump, or document and enforce a bounded wait.

## Checked and clean

- `dlopen`/`dlsym` resolution: `10_prelude.c:57-84`, `110-130` opens both libraries with `RTLD_NOW|RTLD_GLOBAL`, records a missing symbol by name, closes both handles on any failed resolve, and re-runs every mandatory resolve on retry; `shim_ready` rather than the handles gates success. Lazy resolvers (`shim_sym_or_null`) never poison launch. No defect found in the mandatory path.
- GLib string ownership: `10_prelude.c:16-35`, `80_clipboard.c:34,63`, `81_opener.c:41,91`, `82_osinfo.c`, `83_dialog.c:118-135`, `30_webview.c:113-120`, `70_keyring.c:124-145`, `80_notify.c:99-108` all copy GLib data into static buffers or free with resolved `g_free`/`g_error_free`/`g_object_unref`/`secret_password_free`/`g_slist_free`; Bun's `free` is never handed a GLib block. `shim_window_title` and `shim_webview_title` return GTK/WebKit-owned pointers read immediately as `cstring`, never stored or freed. No ownership defect found.
- FFI arity and width: `shim-symbols.ts` vs every C prototype in `shim/*.c` — all entry points checked (including `shim_window_new` 5 args, `g_signal_connect_data` 6 args returning `unsigned long`, the 8-arg `evaluate_javascript`, and `double`/`f64` opacity); no drift found. The `GdkAtom` selection is correctly passed as a pointer-width value (`80_clipboard.c:16,50`).
- GTK signal lifetimes: `shim_on_destroy`, `shim_on_load_changed`, `shim_on_load_failed`, `shim_on_eval_done`, `shim_dlg_response`, `shim_tray_on_item`, `shim_tray_on_popup` all match their GTK/WebKit callback signatures in argument count and return width; callback `data` is either null or a small integer tag. No lifetime bug found beyond the widget-destruction races reported above.
- `g_main_context_iteration` reentrancy: `50_pump.c:27-31` iterates with `may_block=0`; every C signal handler only writes C statics and never re-enters JS, so no JS reentrancy via the pump. The nested main loop that would freeze timers is explicitly avoided for file panels (`83_dialog.c:1-11`).
- Locale handling: `cstring`/`uncstring` (`cstring.ts`), `bcp47` (`os-info.ts:50-53`) and `shim_os_locale` (`82_osinfo.c:30-41`) — no `toLocale*`/`Intl`/`setlocale` calls in this directory; BCP-47 normalization strips codeset and modifier and maps `_`→`-` correctly for the language names GLib returns. Embedded NUL in a JS title/URL truncates at C, but the title readback check turns that into a visible error rather than a silent success. No locale-dependent defect found.
- C buffer bounds: `shim_set_error`, `shim_copy_text`, `shim_dlg_copy`, `shim_opener_note`, `shim_reason`, `shim_keyring_get`'s truncation check — all bounded and NUL-terminated within their declared buffers; no off-by-one found.
