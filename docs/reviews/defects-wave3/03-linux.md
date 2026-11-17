# Linux platform (`src/platform/linux/`)

Area: the GTK3 + WebKitGTK driver, the C shim compiled at launch, the preflight, and `scripts/linux-smoke.ts`.

## Findings

### 1. The preflight never runs at Linux launch — the smoke's central claim is false — MEDIUM
`src/platform/linux/preflight.ts:73`, `src/platform/linux/backend.ts:51`, `scripts/linux-smoke.ts:56`

`dlopenProbe`/`preflightErrors` are called only by the smoke, the tests, and the doctor; `loadPlatform` calls `linux.createPlatform` directly and `LinuxPlatform.start()` goes straight to `backend.load()` → `shim_lib_open()`. No production path calls the probe. The smoke says it runs "the same dlopen probe the platform runs at launch", which the source does not do.

**Breaks:** a reader trusts the smoke's "preflight" PASS as proof of the launch check; the launch check is actually the C shim's `shim_lib_open`, a different path with different coverage. The probe code is dead at runtime.
**Evidence:** `scripts/linux-smoke.ts:56` "The libraries, through the same dlopen probe the platform runs at launch." vs `src/platform/linux/backend.ts:54` `if (Number(symbols.shim_lib_open() ?? 0) !== 1)` and the only `preflightErrors()` call outside tests being `scripts/linux-smoke.ts:57`.

### 2. Preflight checks 2 of the ~15 symbols the shim resolves — MEDIUM
`src/platform/linux/preflight.ts:17`, `scripts/linux-smoke.ts:62`

`PREFLIGHT` probes only `gtk_init_check` and `webkit_web_view_new`. The shim requires twelve more (`webkit_web_view_load_uri`, `g_main_context_iteration`, `gtk_window_new`, `gtk_window_set_title`, `gtk_window_set_default_size`, `gtk_widget_set_size_request`, `gtk_container_add`, `gtk_widget_show_all`, `gtk_widget_destroy`, `g_signal_connect_data`, plus the optional proof symbols). The smoke's success line claims the two libraries load "with the symbols the shim resolves".

**Breaks:** a partial/older library that exports the two probed symbols but lacks a required one passes preflight and fails later at `shim_lib_open()` with a bare "missing symbol" error rather than at the check that claims completeness.
**Evidence:** `preflight.ts:18-23` lists exactly two entries; `src/platform/linux/shim/30_webview.c:118-119` and `src/platform/linux/shim/40_window.c:17-24` and `src/platform/linux/shim/50_pump.c:11-12` resolve the rest.

### 3. The window slot table never reclaims slots — the 33rd cumulative window is untracked — MEDIUM
`src/platform/linux/shim/40_window.c:35`, `src/platform/linux/shim/40_window.c:63`

`shim_slots[32]` and `shim_slot_count` grow on every `shim_window_new` and never shrink. `shim_on_destroy` and `shim_window_destroy` only flip `alive = 0`; no slot is freed or reused. Once 32 windows have been created over the process lifetime, any new window gets no slot, so `shim_window_alive` returns 0 for it.

**Breaks:** an app that opens and closes more than 32 windows sees `platform.window(label)` return `undefined` for a window that is still on screen; `window-all-closed` can then fire and quit the app while a window is displayed.
**Evidence:** `40_window.c:63-67` `if (shim_slot_count < 32) { shim_slots[shim_slot_count].win = win; ... shim_slot_count++; }` with no matching decrement in `shim_on_destroy` (`:38-42`) or `shim_window_destroy` (`:84-89`).

### 4. A failed load retry leaks one `dlopen` handle per attempt — LOW
`src/platform/linux/shim/10_prelude.c:89`

On a failed `shim_lib_open` the handles stay set but `shim_ready` stays 0. `backend.open()` leaves `opened = false`, so a retry (allowed by `LinuxPlatform.start()`) re-enters `shim_lib_open`, which calls `shim_open("libgtk-3.so.0")` again and overwrites `shim_gtk` without closing the old handle.

**Breaks:** each retry keeps another reference to libgtk-3 in the process; the failure path is exactly the one a user retries after installing a package.
**Evidence:** `10_prelude.c:92` "if (shim_ready) return 1" (handles are not the guard) then `:94` `shim_gtk = shim_open("libgtk-3.so.0")`; `backend.ts:58` `opened = true` is reached only on success.

### 5. A failed JS evaluation leaks its `GError` — LOW
`src/platform/linux/shim/30_webview.c:100`

`shim_on_eval_done` reads `gerror->message` from the `GError**` filled by `webkit_web_view_evaluate_javascript_finish` but never calls `g_error_free` (not resolved in the shim at all). That GError is caller-owned. The `value`, if set alongside an error, is also not unref'd in that branch.

**Breaks:** repeated script errors accumulate GLib allocations; no wrong result, only a slow leak on the error path.
**Evidence:** `30_webview.c:100-105` the error branch copies the message and returns with no `g_error_free`/`shim_object_unref`, while the success branch at `:111-112` frees and unrefs correctly.

### 6. `LinuxBackend.destroy` has no production caller — LOW
`src/platform/linux/backend.ts:33`, `src/platform/linux/backend.ts:111`

`destroy` is implemented and exercised only by `backend.test.ts`; the `Platform` interface (`src/app-types.ts:25`) has no close method, and neither `app.ts`, the smoke, nor any script calls it. The C `shim_window_destroy` is reachable only through that dead seam.

**Breaks:** nothing at runtime; a maintained native call with no caller, and no programmatic window close on Linux.
**Evidence:** the only `destroy(` call sites under `src/platform/linux` and `scripts/linux-smoke.ts`/`scripts/linux` are the interface, the implementation, and the C definition — never a call from the platform or app.

## Coverage

Read in full: `shim-ffi.ts`, `preflight.ts`, `platform.ts`, `backend.ts`, `index.ts`, `cstring.ts`, `shim-source.ts`, all four `shim/*.c` parts, `scripts/linux-smoke.ts`, `scripts/linux/proof-steps.ts`, `scripts/linux/proof-eval.ts`, plus the four linux tests (`preflight`, `shim-source`, `backend`, `platform`) and the `preflightErrors`/`loadPlatform` call sites in `src/`.

Checked and found correct, not reported: `g_free` vs Bun's `free` — GLib strings in `shim_on_eval_done` go through `shim_g_free` resolved via `dlsym`, never the shim's `free`; the `malloc`/`free` externs in `10_prelude.c` are unused. All `dlsym` results are checked before use, and both dlopen handles are process statics — there is no per-window `dlopen` and no missing-symbol check after use. The load-state machine's sticky-failure rule correctly keeps state 4 when WebKit follows `load-failed` with FINISHED; the "refused connection emits no load-failed" case is documented in `proof-steps.ts:102-106` and the smoke deliberately uses a missing file. The pump re-arms unconditionally and ignores `g_main_context_iteration`'s return, so a short return cannot starve it; `platform.pump` validates the interval and stops any prior chain.

Not examined: the darwin/windows platform implementations, `src/app-types.ts` beyond the `Platform` shape, `src/cli/doctor/*` (the doctor's window check imports darwin, not linux), and the `site/` design docs. A next pass could check the doctor's Linux window check and whether `site/app/docs/design/page.mdx` repeats the preflight-at-launch claim.
