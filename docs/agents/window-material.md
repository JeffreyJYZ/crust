# Lane C — window material

Butter source read at `~/dev/resources/butter-src/src/shim/{darwin.m,windows.c}` (read-only, no build).

- darwin.m:114-123: `NSVisualEffectView`, blend `BehindWindow`=0, state `Active`=1, material `Sidebar`=7, `addSubview:positioned:NSWindowBelow`(-1), `setOpaque:NO`, clear background → `shim/115_window_material.c`; `window-create.ts` adds full-size content mask, transparent titlebar.
- darwin.m:1240,2140: `drawsBackground=NO` is load-bearing — WebKit paints over the effect otherwise → `shim_webview_set_draws_background` in `shim/30_webview.c`.
- windows.c:2388-2402: DWM attribute 38, `mica`=2/`acrylic`=3/`tabbed`=4; Butter also sends 20 (immersive dark) and silently no-ops on old builds. Crust refuses build < 22621 with `CrustError("not-implemented")` before creating a window, leaves attribute 20 alone, destroys the window on a refused HRESULT.

Files: `config/types.ts`, `config/validate-windows.ts`, darwin `shim/{115_window_material,30_webview}.c` + `shim-source.ts`/`shim-symbols.ts`/`index.ts`/`window-create.ts`, windows `shim/46_material.c` + `shim-source.ts`/`backend.ts`/`ffi.ts`/`fake-shim.ts`/`fake-backend.ts`/`window-open.ts`.

Proof: `config/validate-material.test.ts`, `darwin/window-material.test.ts`, `windows/window-material.test.ts` — 39 pass / 0 fail over 7 files. Windows C proved by compiling assembled `shimSource` with TinyCC here (kernel32 imports stubbed, nothing executed) + source assertions; runtime path via fake shim. No Windows runner.

Gates: `bun check` red only on another lane's `darwin/power.ts` (`onSleep`/`onLock` missing); `bun run check:lines` PASS; `bun fmt` applied to changed TS.
