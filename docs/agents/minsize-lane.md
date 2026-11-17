# minsize lane — Lane B of `docs/reviews/fix-wave2/BRIEF-2.md`

Task: make `minWidth`/`minHeight` real on darwin and Windows, and clamp create size. Done in owned files only.

## Changes

- `src/config/types.ts:8` — `WindowConfig.minHeight?: number`.
- `src/config/validate-windows.ts:3` — `minHeight` added to `WINDOW_KEYS`; validated with `v.positiveInteger` at `:27`. Absent stays absent; `0`, negative, float and string are refused with path `windows[i].minHeight`.
- `src/platform/darwin/window-create.ts:19` — pure `windowSize()` helper clamps each dimension to its minimum and returns zeros for unset dimensions. `createNativeWindow` uses it at `:38`, and calls `shim_window_set_min_size(win, minWidth, minHeight)` at `:48`. Previously an unset min height was silently forced to the create `height`; now zero means AppKit's "no constraint".
- `src/platform/windows/window-open.ts:16` — exported `MinSizeOptions = WindowOptions & { minHeight?: number }` (the config carries it, `WindowOptions` has not caught up). `openWindow` clamps create `width`/`height` to `minWidth`/`minHeight` before `shim_window_new`.
- `src/platform/windows/shim/10_prelude.c` — `#define SHIM_WM_GETMINMAXINFO 0x0024u` and declarations of `shim_window_set_min` / `shim_window_min`.
- `src/platform/windows/shim/42_webview.c:11-15` — `g_min_w`, `g_min_h`, `g_min_hwnd`, `g_min_count` beside `g_hwnd`; accessors store/read the minimum keyed by HWND.
- `src/platform/windows/shim/40_window.c` — `shim_window_new` records the create size as the drag floor; `shim_window_destroy` clears it, so a reused HWND cannot inherit a stale floor.
- `src/platform/windows/shim/20_class.c` — `WM_GETMINMAXINFO` writes `pt[6]`/`pt[7]` (`ptMinTrackSize`, byte offset 24 on x64) from the per-HWND minimum, then falls through to `DefWindowProcW` so the max fields keep Windows' defaults.

## Tests added

- `src/config/validate-windows-min.test.ts` — accept/carry/validation of `minHeight`, plus `minWidth` regression.
- `src/platform/windows/window-open.test.ts` — clamped create size for both dimensions; above-minimum size unchanged.
- `src/platform/windows/min-size.test.ts` — source assertions for the message id, the per-HWND table, and `ptMinTrackSize` writes (same pattern as `shim-resources.test.ts`).
- `src/platform/darwin/min-size.test.ts` — behavioural tests of the pure `windowSize()` helper: clamp, above-min no-op, zeros for absent, minHeight alone.

## Design decision and limitation

The Windows FFI declaration in `ffi.ts` pins `shim_window_new` to four arguments (`[CS, I32, I32, CS]`) and `backend.ts` pins the `WindowsShim` type; neither is in this lane's file list. So the C minimum is set from the **clamped create size** passed to `shim_window_new`, not from a separately supplied config value. Consequence: when configured `width` exceeds `minWidth`, the enforced drag floor is the create width rather than the smaller configured `minWidth` (e.g. default 1100 with `minWidth: 800` floors at 1100). The requested "width below minWidth never opens smaller" guarantee holds exactly.

**Needs owner action for exact configured minimum:** add a `shim_window_set_min_size(hwnd, w, h)` symbol to `src/platform/windows/ffi.ts`, `backend.ts` and `fake-shim.ts`, call it from `window-open.ts` with `minWidth`/`minHeight` directly, and stop deriving the floor from the create size. Those three files belong to another lane; not touched here.

## Verification

- `bun check` — clean (641 files).
- `bun test` on the four new/owned test files — 15 pass, 0 fail.
- `bun fmt` on changed TS files, then `bun fmt --check` — 8 files formatted.
- `bun run check:lines` — PASS; `42_webview.c` is the largest touched file at 196 lines.
- C compile proof: `shimSource` written to a temp file, `clang -fsyntax-only -std=c11 -Wall` — zero diagnostics. BRIEF-2 points at `docs/agents/windows-fixes.md` for this trick, but that file does not exist in the tree; the pattern in `shim-resources.test.ts` plus a direct `clang` run was used instead.
- Full suite, e2e and build were not run (twelve other lanes are writing at once).
- `docs/agents/extensions-fixes.md` was already modified by another lane; left untouched.
