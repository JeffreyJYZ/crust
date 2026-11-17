# linux fix wave — 03-linux.md + 11-probes.md finding 2

Scope: `src/platform/linux/**`, `scripts/linux-smoke.ts`, `scripts/linux/**`. Reports: `docs/reviews/defects-wave3/03-linux.md`, `docs/reviews/defects-wave3/11-probes.md` finding 2 only.

## Fixed

1. **Preflight at launch** — `src/platform/linux/backend.ts:63`. `createGtkBackend(symbolsFor, probe = preflightErrors)` runs the probe at the top of `open()`, before `shim_lib_open()`. A failed probe throws the named missing-symbol text and never touches C; `opened` stays false, so a retry re-runs the probe. Tests inject `() => []`, so no machine needs GTK. `scripts/linux-smoke.ts:56-64` now says the same probe runs at launch — true. The smoke still calls `preflightErrors()` explicitly for its own verdict line; the launch calls it again. That double probe is intentional and cheap (12 `dlopen`s).
2. **Every mandatory symbol probed** — `src/platform/linux/preflight.ts:23-43`. `PREFLIGHT` grew from 2 to 12 entries: all symbols resolved with `shim_sym` in the three C parts. GLib/GObject symbols are probed on the GTK/WebKit handles, matching how `dlsym` on a `dlopen`ed library searches its dependencies and how the shim resolves them. Optional proof symbols (`evaluate_javascript` and friends) stay out on purpose: an older WebKitGTK must still launch an app.
3. **Slot table reclaims** — `src/platform/linux/shim/40_window.c:40-54,83-99`. `shim_slot_release` clears `win` and `alive`; `shim_on_destroy` and `shim_window_destroy` both call it. `shim_window_new` reuses the first clear slot, then grows up to 32. The ceiling is now simultaneous windows, not cumulative ones. A stale pointer no longer matches any slot, so `shim_window_alive` answers 0 for it.
4. **No dlopen leak on retry** — `src/platform/linux/shim/10_prelude.c:94-123`. Added `extern int dlclose` and `shim_close_libraries()`, called on both failure branches (WebKit open failed, any resolve failed). Handles are zeroed, so a retry opens fresh ones. Cached function pointers from a closed library are never called: `shim_ready` stays 0 and the JS backend keeps `opened = false` until a full open succeeds.
5. **GError freed on script failure** — `src/platform/linux/shim/30_webview.c:31,105-112,135`. Resolve `g_error_free` optionally and free the caller-owned `GError` in the error branch; unref a `value` returned alongside an error. Uses GLib's own free, never the shim's `free` (Bun's mimalloc export faults on a GLib block — measured earlier at `0xA6D0`).
6. **`destroy` has a production caller** — `src/platform/linux/platform.ts:103-108,119`. Added `LinuxPlatform.destroy(label)` (native close + forget), called for every tracked window from `quit()` before `backend.quit()`. This is a Linux-only method, not a change to the `Platform` interface in `src/app-types.ts` (another lane's file).
7. **Pump counts native slices** — `src/platform/linux/shim/50_pump.c:26-31`, `src/platform/linux/backend.ts:86-90`, `src/platform/linux/platform.ts:52-57`. `shim_pump` now returns 1 when it actually called `g_main_context_iteration` (an idle context that dispatches nothing still counts as a slice), 0 only when the function pointer is absent. `LinuxBackend.iterate()` returns a boolean; `#ticks` advances only on true. The smoke's `${ticks} g_main_context_iteration slices` is now a native count, not a `setTimeout` count.

## Tests added

- `src/platform/linux/preflight.test.ts` — every mandatory symbol present; optional proof symbols absent; a library missing only `g_main_context_iteration` is rejected by name.
- `src/platform/linux/backend-preflight.test.ts` (new) — load probes first and makes no C call on failure; a retry after the probe passes reaches `shim_lib_open`/`shim_gtk_init`.
- `src/platform/linux/platform.test.ts` — a backend that reports no native iterations leaves `ticks` at 0 while the timer keeps firing; `destroy(label)` closes through C once and prunes; `quit()` closes every tracked window.
- `src/platform/linux/shim-source.test.ts` — source contracts for slot release/reuse, `dlclose` on both failure branches, `g_error_free` on the error path, and the pump's native-iteration return. These are source-shape assertions because the C parts need GTK to run; the whole shim still compiles with TinyCC on this macOS host (`bun -e 'import {shim} …; shim()'` → 17 symbols).

## Not fixed / handed over

- `docs/agents/linux-platform.md:8` and `:10` still describe the two-symbol preflight and a 32-slot cumulative ceiling. That file is not in this lane's ownership; the coordinator owns the update.
- `src/app-types.ts` has no close method, so programmatic window close is exposed on `LinuxPlatform` only, not through the shared `Platform` seam.

## Verification

`bun check` clean (602 files). Scoped `bun test` on the five linux test files: 47 pass, 0 fail. `bun run check:lines`: PASS. `bun fmt` run only on the changed TS files. No full suite, e2e or build (twelve lanes writing at once).
