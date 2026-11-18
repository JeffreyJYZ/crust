# Next wave: platform gaps (Lane 1)

Question: what does darwin answer that Linux and Windows refuse, and why. Measured 2026-11-18 against the tree in `~/dev/crust`. Every claim below has the command or the file:line that produced it.

## The shape of the gap

Two different failures, and they are often confused:

- **`not-implemented`** — the plugin is registered, but its adapter is absent, so a handler returns `notImplemented(...)` and `PluginRegistry.invoke` turns that into a `CrustError` (`src/plugins/registry.ts:82-84`). A page can branch on it.
- **`unknown-plugin`** — the namespace is never registered on Linux/Windows at all (`src/plugins/registry.ts:71-72`), and naming it in `config.plugins` throws at startup (`src/runtime-shim.ts:42-45`). A page cannot branch on this; the app does not boot.

The split is at `src/runtime-plugins.ts:78-93`. The non-darwin branch registers only the seven core plugins plus a bare `window`, bare `power`, bare `screen`, and the Bun-backed `store`, `database`, `keychain`, `shell`, `sidecar`, `updater`. The darwin branch (`:94-196`) adds 19 more namespaces with real adapters. So macOS has a native plugin layer; Linux and Windows have a platform shell (window creation, pump, screen C shim, Windows credential store) and nothing above it.

Evidence commands:

- `rg -n 'not-implemented' src/platform src/runtime-plugins.ts src/runtime-keychain.ts site/app/docs/reference/parity/page.mdx site/app/docs/limits/page.mdx`
- `rg -n 'linuxScreenAdapter|windowsScreenAdapter' src --glob '!*.test.ts'` — only the defining files, no caller.
- `rg -n 'selectedPlugins|unknown plugin' src/runtime-shim.ts src/plugins/registry.ts`

## Ranked gaps

Ranked by how likely a real app hits it. "Reachable" means a `bun:ffi`/`dlopen` binding is possible with the libraries this repo already loads; it does not mean the adapter is written.

### 1. `window.*` — all 26 commands (not-implemented) — HIGH

`src/runtime-plugins.ts:81` registers `createWindowPlugin()` with no adapter; `src/plugins/window.ts:57` answers `missingWindow(command)` for every command, naming `NSWindow` (`src/plugins/window-args.ts:14-19`). The platform still creates the configured windows directly (`src/platform/linux/platform.ts:81`, `src/platform/windows/platform.ts:140`), so an app boots with a window it cannot title, focus, close, resize or list from the page.

Native answer: GTK `gtk_window_set_title`, `gtk_window_resize`, `gtk_widget_show` on Linux (some already bound at `src/platform/linux/shim/40_window.c:15-19`); Win32 `SetWindowTextW`, `ShowWindow`, `MoveWindow` on Windows (`SetWindowTextW` already bound at `src/platform/windows/shim/12_win32.c:51`, wrapped at `src/platform/windows/shim/40_window.c:25`). **Reachable: yes, no new library on either platform.** Cost: **project** — a `WindowNative` adapter plus event wiring, but the hard native calls are already in the shims. A real app hits this on its first non-trivial window interaction.

### 2. `dialog.*` — openPanel/savePanel/cancel (not-implemented) — HIGH

Bare core plugin at `src/plugins/core.ts:27`; refusals at `src/plugins/dialog.ts:78`, `:95`, `:110`.

Native answer: GTK `GtkFileChooserDialog` on Linux — `libgtk-3.so.0` is already `dlopen`ed at `src/platform/linux/shim/10_prelude.c:110`. Win32 `IFileDialog` COM on Windows — COM is already initialised at `src/platform/windows/platform.ts:87`. **Reachable: yes.** Cost: **moderate** on Linux, **project** on Windows (hand-written COM vtable). Any app that opens or saves a file hits this immediately.

### 3. `screen.list` / `screen.primary` — not-implemented, but already solved on disk — HIGH VALUE, CHEAPEST FIX

Bare registration at `src/runtime-plugins.ts:85`; refusal at `src/plugins/screen.ts:133`, `:147`, `:157`. The refusal names the right call per platform (`REQUIRES` at `:174-178`: `gdk_display_get_monitor` / `EnumDisplayMonitors`).

Both native adapters are written and tested: `src/platform/linux/screen.ts:51` and `src/platform/windows/screen.ts:54`. The C shims are complete too — GDK enumeration at `src/platform/linux/shim/60_screen.c:28-91`, `EnumDisplayMonitors` bound at `src/platform/windows/shim/12_win32.c:58`. They are never imported outside their own files. **Reachable: yes, already compiled.** Cost: **cheap** — wire the two adapters into the non-darwin branch. Only caveat: both adapters are marked UNPROVEN ON REAL GTK/WINDOWS, so wiring needs a smoke on a real display before it can be called done.

### 4. `keychain.*` on Linux (not-implemented) — MEDIUM

`src/runtime-keychain.ts:24` returns a bare plugin; refusals at `src/plugins/keychain.ts:79-84`, naming `libsecret and a running keyring daemon` (`:44`). Deliberate: a plaintext fallback is worse than a refusal.

Native answer: libsecret `secret_password_store_sync` / `secret_password_lookup_sync`. **Reachable in principle** — `libsecret-1.so.0` is dlopenable and the GTK pump iterates the GLib main context — but it needs a running keyring daemon (gnome-keyring or KWallet), a distributed secret service, and an async-design adaptation. Cost: **project**. Verdict: **stay refused** until a real Linux user base asks; this is the one refusal whose reason is a product decision, not a missing binding.

### 5. `keychain.list` on Windows (not-implemented) — MEDIUM, CHEAP

`src/platform/windows/keychain.ts:70-71` omits `list`; refusal at `src/plugins/keychain.ts:160-165`.

Native answer: `CredEnumerateW`. `CredFree` is already resolved at `src/platform/windows/shim/48_keychain.c:67` and used at `:128`; the DLL (`advapi32`) and the `LoadLibraryA`/`GetProcAddress` pattern are already there. **Reachable: yes — one more `GetProcAddress` plus a C export and a TS binding.** Cost: **cheap**. Worth doing; the comment's suggested workaround ("enumerate from the app's own index") is a poor substitute for an API the process already has loaded.

### 6. `tray.*` (not-implemented) — MEDIUM

Bare core plugin at `src/plugins/core.ts:29`; refusals at `src/plugins/tray.ts:44`, `:52`, naming `NSStatusBar`.

Native answer: GTK status icon on Linux (deprecated; the honest cross-desktop answer is libappindicator / D-Bus StatusNotifierItem); `Shell_NotifyIconW` on Windows — `shell32` is not among the modules `src/platform/windows/shim/12_win32.c:30-61` loads today. **Reachable: yes via dlopen/LoadLibrary, but a new C surface on both.** Cost: **project** on both; the Linux variant in particular needs a D-Bus name and a menu protocol. A tray icon is common enough to be felt, but it is not a weekend's work.

### 7. `notification.*` (not-implemented) — MEDIUM

Bare core plugin at `src/plugins/core.ts:28`; refusals at `src/plugins/notification.ts:83`, `:100`. `requestPermission` is `not-implemented` on **every** platform (`site/app/docs/limits/page.mdx:77`), because the notification itself asks — that one is a contract, not a gap.

Native answer: libnotify / D-Bus `org.freedesktop.Notifications` on Linux — reachable, **moderate**. WinRT toast on Windows (`Windows.UI.Notifications`) needs WinRT activation and asynchronous COM interfaces, not a flat C ABI; there is no Windows notification shim in `src/platform/windows/shim/`. **Reachable on Windows only with a new WinRT layer.** Cost: **project**, and the reasonable verdict is **stay refused on Windows** near-term.

### 8. `power.*` — 4 pull commands and 6 push events (not-implemented) — MEDIUM

Bare registration at `src/runtime-plugins.ts:83`; refusal at `src/plugins/power.ts:74-79`, hard-coded to IOKit even on Linux/Windows. The six event commands refuse at the same place.

Native answer: UPower and logind over D-Bus on Linux (battery, AC, sleep, lock; idle needs `org.freedesktop.ScreenSaver`) — reachable with a raw AF_UNIX D-Bus socket or a dlopened libdbus plus main-loop integration, but a real subsystem. Windows: `RegisterPowerSettingNotification`, `WTSRegisterSessionNotification`, `SetThreadExecutionState` via `LoadLibraryA` — reachable in the same style as the existing shim. Cost: **project on both.** Verdict: **stay refused** until there is a Windows/Linux target that needs it.

### 9. Lifecycle events — silent rather than refused — MEDIUM

`src/platform/linux/platform.ts:143-145` and `src/platform/windows/platform.ts:189-191` return `unsupportedLifecycle(...)`; the throw is defined at `src/app-types.ts:70-78`. Native answer: GTK focus/delete-event signals and `WM_ACTIVATEAPP`/`WM_QUERYENDSESSION` in the WndProc — both event loops already exist, so **reachable and moderate**.

Important nuance: `watchLifecycle` catches the throw at `src/app-watch.ts:117-125`, so a page that registers `app.on('before-quit', …)` gets **no event and no error**. The parity page's claim that a platform without the concept "answers not-implemented naming it" (`site/app/docs/reference/parity/page.mdx:93`) is true only for code that calls `platform.lifecycle().take()` directly; the page-facing behavior is silence. Fixing that honesty bug is **cheap**; implementing the events is **moderate**.

### 10. Entire namespaces never registered on Linux/Windows — `unknown-plugin` — HIGH REACH, MIXED COST

Never present in the non-darwin branch (`src/runtime-plugins.ts:78-93`) but registered on darwin (`:94-196`): `clipboard`, `opener`, `os`, `shortcuts`, `window-state`, `positioner`, `menu`, `theme`, `dock`, `accessibility`, `navigation`, `findinpage`, `downloads`, `network`, `crash-reporter`, `i18n`, `deep-link`. Seventeen namespaces. A page calling any of them gets `unknown-plugin`; listing one in `config.plugins` throws at startup (`src/runtime-shim.ts:42-45`).

- **findinpage** — WebKitGTK has `webkit_find_controller_search`, `webkit_find_controller_count_matches` and `webkit_find_controller_search_finish` in `libwebkit2gtk-4.1.so.0`, which the shim already loads (`src/platform/linux/shim/10_prelude.c:114`). **Reachable: yes**, and it would beat darwin's 0-or-1 `matches` (parity page `:71`). Cost: **moderate** on Linux; Windows WebView2 `ICoreWebView2.Find` is a **project**.
- **clipboard, opener, shortcuts, theme, i18n, os, positioner, window-state** — mostly GTK/Win32 calls or pure TypeScript; `app.info()` already covers part of `os` (`src/runtime-app-namespace.ts:33-35`). Cost: **cheap to moderate** each, but each needs its own adapter.
- **navigation, downloads, network, accessibility, menu, dock, crash-reporter, deep-link** — need delegate/event plumbing in the native shims. Cost: **project** each.

This is the largest single gap by surface area, and it is the one a documented "cross-platform" app is most likely to walk into. Registering the bare plugins on non-darwin (so the answer becomes an honest `not-implemented`) is a **cheap** first step that converts seventeen startup errors or `unknown-plugin` results into branchable errors.

## Documentation note

The parity page counts these rows as **same** (`site/app/docs/reference/parity/page.mdx:117-125`) because they describe the API contract, not per-platform behavior. `same` there means "crust ships the surface", not "the surface answers on Linux and Windows". Nothing in that page carries a per-platform status column, so a reader cannot see the gap this report describes. That is a real documentation defect — the two `partial` rows (`:119`, `:125`) are Linux keychain and find's `matches`, and neither names the `unknown-plugin` wall.

## Verdicts

- **Cheap, do now:** wire `linuxScreenAdapter` / `windowsScreenAdapter` (#3); bind `CredEnumerateW` (#5); register the bare darwin-only plugin names on non-darwin so they answer `not-implemented` instead of `unknown-plugin` (#10 first step); surface the lifecycle refusal to the page (#9 honesty half).
- **Project, worth scoping:** `window` adapter (#1), `dialog` (#2), `findinpage` on WebKitGTK (part of #10), `tray` (#6), `clipboard`/`opener`/`shortcuts` group.
- **Stay refused for now:** Linux keychain (#4) and Windows notifications (#7) — both need a subsystem (keyring daemon / WinRT), not a binding; Windows/Linux power events (#8) unless a target needs them.
