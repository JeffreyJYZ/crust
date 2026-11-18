# Platform capability matrix: what actually answers on Windows and Linux

`nativePlugins` registers the same 32 namespaces on every OS (`src/runtime-plugins.ts:43`), so a page
can always call `clipboard.read` — the question this file answers is what comes back. One verdict per
cell, plus the exact failure and the smallest fix for every cell that is not `works`.

**Tree read:** commit `a8e8306` plus the uncommitted lane edits present on 2026-11-18 21:26
(`src/runtime-plugins.ts`, `src/runtime-plugins-other.ts`, `src/platform/windows/*`,
`src/platform/linux/*`, the new `src/platform/linux/shim/4*_window*.c`). Both window adapters are
**in flight and uncommitted**; §3 states exactly how far each one reaches.

## How each verdict was established

- **`measured`** — a probe built the registry the OS would get and invoked every command of every
  namespace, recording the real answer. The probe was `nativePlugins(corePlugins, undefined, {}, os)`
  with `os = "darwin" | "win32" | "linux"`, run on this macOS machine; it was deleted before this file
  was written (the brief asks for the matrix, not new tests). This is a real measurement of the
  registration and refusal path, and **not** an observation of Win32 or GTK behaviour — no Windows or
  Linux machine was touched. The only commands skipped were ones that mutate state on this machine
  (`store.set`, `fs.write`, `autostart.enable`, `keychain.set`, `updater.install`, …), so "all commands
  refuse" below is measured rather than inferred.
- **`read`** — the adapter and its backend were read; no runtime observation is claimed.
- Two namespaces are chosen by `process.platform` *inside* the plugin, so a darwin-machine probe would
  report the wrong arm: `screen` (`src/runtime-non-darwin.ts:65`) and `keychain`
  (`src/runtime-keychain.ts:14`). Those two rows are `read`, not `measured`. `power`, `network.status`
  and `accessibility` carry per-OS `requires` strings from a map, so their *verdict* is measured and
  the *symbol* is read.

## Verdict vocabulary

| Cell | Meaning |
| --- | --- |
| `works` | The platform backend implements it and the adapter reaches it. |
| `works*` | It runs, but the path it uses is macOS-shaped (`~/Library/Application Support/...`). |
| `partial` | Some commands answer, others refuse; §2 names which. |
| `refuses` | Registered, and every command returns a typed `not-implemented` naming the missing call. |
| `absent` | Not registered at all — the page gets `unknown-plugin`. |
| `broken (silent)` | Answers `ok: true` and does something useless — worse than a refusal, because nothing signals it. |
| `n/a` | The concept does not exist on that OS; it still answers a typed refusal rather than vanishing. |

The `Source` column says how far the row was observed. `measured` means the Windows and Linux cells
came from the probe; every macOS cell in the table is read, because no macOS app was launched — the
darwin branch was never exercised. `read` means the verdict rests on reading the platform backend
instead: `screen` and `keychain` pick their adapter from `process.platform` *inside* the plugin, so a
probe on this machine cannot reach the Windows or Linux arm at all.

## 1. The matrix

| Namespace | macOS | Windows | Linux | Source |
| --- | --- | --- | --- | --- |
| `fs` | works | works | works | measured |
| `store` | works | works* | works* | measured |
| `database` | works | works* | works* | measured |
| `logging` | works | works* | works* | measured |
| `shell` | works | works | works | measured |
| `sidecar` | works | works | works | measured |
| `stronghold` | works | works | works | measured |
| `keychain` | works | works | partial (`list` refuses) | read |
| `screen` | works | works | works | read |
| `os` | works | partial | partial | measured |
| `window` | works | partial | partial (`label` only) | measured |
| `window-state` | works | works | refuses | measured |
| `positioner` | works | refuses | refuses | measured |
| `clipboard` | works | refuses | refuses | measured |
| `opener` | works | refuses | refuses | measured |
| `shortcut` | works | partial | partial | measured |
| `dialog` | works | refuses | refuses | measured |
| `notification` | partial | refuses | refuses | measured |
| `tray` | works | refuses | refuses | measured |
| `menu` | works | refuses | refuses | measured |
| `theme` | works | refuses | refuses | measured |
| `dock` | works | n/a | n/a | measured |
| `power` | works | refuses | refuses | measured |
| `accessibility` | works | refuses | refuses | measured |
| `navigation` | works | refuses | refuses | measured |
| `findinpage` | partial | refuses | refuses | measured |
| `downloads` | works | refuses | refuses | measured |
| `network` | works | refuses | refuses | measured |
| `crash-reporter` | works | partial | partial | measured |
| `i18n` | works | partial | partial | measured |
| `deep-link` | partial | partial | partial | measured |
| `autostart` | works | broken (silent) | broken (silent) | measured |
| `updater` | partial | partial | partial | measured |

`updater` is the 33rd and conditional one: it is registered only when the config has an `updater`
section (`src/runtime-plugins.ts:72`), so it is not part of the 32.

**Counts of `works` (or `works*`)**: macOS 29 of 32, Windows 10 of 32, Linux 8 of 32. macOS's three
non-`works` cells are `notification`, `findinpage` and `deep-link`, each `partial` for a documented
reason. Windows and Linux now differ in only three rows — `keychain` (`list`), `window` and
`window-state` — and the last two are exactly where the uncommitted Windows window adapter lands. No
cell is `absent` on either OS: both arms register all 32 namespaces (measured).

## 2. Ranked: what a normal app hits first

Ordered by how badly an ordinary app needs the thing, per the brief. Everything below is a
non-`works` cell with its file, its exact answer, and the smallest fix.

### Tier 1 — the app cannot do its job

1. **`clipboard` on Windows and Linux.** `src/plugins/clipboard-contract.ts:74`, requires
   `NSPasteboard`; measured `not-implemented`, all four commands. Fix: one adapter per OS —
   `OpenClipboard`/`GetClipboardData(CF_UNICODETEXT)` on Win32, `gtk_clipboard_get`/
   `gtk_clipboard_set_text` on GTK3 — passed to `createClipboardPlugin` in
   `src/runtime-plugins-other.ts`.
2. **`opener` on Windows and Linux.** `src/plugins/opener.ts:121`, requires `NSWorkspace`; measured
   `not-implemented`, all three commands. Fix: the smallest adapter in the tree — `ShellExecuteW` on
   Windows and a spawn of `xdg-open` on Linux; `shell.spawn` already proves the Linux half works.
3. **`os.info` on Windows and Linux.** `src/plugins/os.ts:105-109`, requires `NSProcessInfo`;
   measured `not-implemented`. `os.paths` works (`os.ts:142`). Fix: the three adapter-only fields are
   already platform-neutral — fill `version` from `os.release()`, `uptime` from `os.uptime()`, and
   `appVersion` from the app id — instead of returning `missing("info")` when no adapter arrived.
4. **`window` and `window-state` on Linux.** `src/plugins/window.ts:57` and
   `src/plugins/window-persist.ts:86`, both requiring `NSWindow`; measured `not-implemented` on every
   command except `window.label`, which needs no adapter (`window.ts:133`) and answers only when the
   request carried a `?window=` identity — with no identity it refuses too
   (`window-label.ts:43`). All six `window-state` commands refuse. A Linux app can open its configured
   window and then cannot size, move, minimise or restore it. Fix: the adapter and its C entry points
   both exist now (`src/platform/linux/window-adapter.ts:21`, `45_window_api.c`,
   `46_window_state_api.c`) — the only missing piece is the linux arm in
   `src/runtime-plugins-other.ts:63`, which today returns the bare plugin for every non-win32 OS.
5. **`dialog` on Windows and Linux.** `src/plugins/dialog.ts:78,95,110`, requires `NSOpenPanel` /
   `NSSavePanel` / `cancel:`; measured `not-implemented`. No file picker at all. Fix: `GetOpenFileNameW`
   / `IFileOpenDialog` on Win32 and `gtk_file_chooser_dialog_new` on GTK3.

### Tier 2 — a normal app wants it

6. **`notification` on Windows and Linux.** `src/plugins/notification.ts:83`, requires
   `UNUserNotificationCenter`; measured `not-implemented`, both commands. Fix: `Shell_NotifyIconW`
   balloon or the WinRT toast API on Windows, `libnotify`/`g_notification` on Linux. The macOS cell is
   `partial` for a different reason: `notify` delivers in a bundled app (an unbundled `crust dev`
   process cannot), and `requestPermission` refuses by design (`notification.ts:100`) because the
   darwin half does not bind the status selector.
7. **`shortcut` on Windows and Linux — partial.** `src/plugins/shortcuts.ts:80`, requires
   `RegisterEventHotKey`; `register`, `unregister` and `unregisterAll` were measured `not-implemented`.
   `isRegistered` and `list` answer from the plugin's own map (`shortcuts.ts:153-160`), so they return
   `false` and `[]` — a page that asks "is my shortcut live?" gets a truthful no rather than a refusal.
   Fix: `RegisterHotKey` on Win32; on Linux an X11 `XGrabKey` or a GTK accelerator group — the shim
   already loads GTK.
8. **`power` on Windows and Linux.** `src/plugins/power.ts:95` with the per-OS map at `:67-71`
   (`RegisterPowerSettingNotification in User32.dll`, `UPower on D-Bus`); measured `not-implemented`.
   Fix: `GetSystemPowerStatus` is one call and covers `state`; the subscription commands can keep
   refusing honestly.
9. **`menu` on Windows and Linux.** `src/plugins/menu.ts:76`, requires `NSMenu`; measured
   `not-implemented`. Lowest-effort honest option is to declare it `n/a` in docs and keep the refusal;
   the real fix is `SetMenu`/`CreateMenu` on Win32 and a GTK menubar on Linux.
10. **`tray` on Windows and Linux.** `src/plugins/tray.ts:44`, requires `NSStatusBar`; measured
    `not-implemented`. Fix: `Shell_NotifyIconW` (the same call notification needs) and `GtkStatusIcon`.
11. **`theme` on Windows and Linux.** `src/plugins/theme.ts:48`, requires `NSAppearance`; measured
    `not-implemented`. Fix: `DwmSetWindowAttribute(DWMWA_USE_IMMERSIVE_DARK_MODE)` on Windows and
    `gtk_settings_set_property(GTK_SETTINGS_GTK_APPLICATION_PREFER_DARK_THEME)` on Linux.
12. **`autostart` on Windows and Linux — the one silent failure.** `src/plugins/autostart.ts:56-58`
   computes `~/Library/LaunchAgents/<id>.plist` with no platform check, and `:141-149` writes it. On
   Windows and Linux it reports `{ok: true, enabled: true}` and creates a macOS plist nothing reads.
   This is worse than a refusal: the app believes it will start at login. Fix: gate on
   `process.platform` and write the OS's own form — `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
   or the Startup folder on Windows, `~/.config/autostart/<id>.desktop` on Linux — or refuse by name.

### Tier 3 — the WebKit-shaped namespaces

All four are darwin adapters over WebKit with no non-darwin half, and all four were measured
`not-implemented` on both OSes. Each has a real equivalent in the toolkit the platform already loads:

13. **`navigation`** — `src/plugins/navigation.ts:71`, requires `WKNavigationDelegate`. Fix: WebView2
    `add_NavigationStarting`/`add_NavigationCompleted` (the Windows shim already exposes
    `shim_navigate_hresult`, `src/platform/windows/ffi.ts:119`); WebKitGTK's `load-changed` signal,
    already handled in `src/platform/linux/shim/30_webview.c:69-91`.
14. **`downloads`** — `src/plugins/downloads.ts:43`, requires `WKDownloadDelegate`. Fix: WebView2
    `DownloadStarting`, WebKitGTK `WebKitDownload`.
15. **`network`** — `src/plugins/network.ts:77`, requires `WKURLSchemeHandler`; `network.status` names
    `INetworkListManager` / `GNetworkMonitor` (`src/plugins/network-status.ts:39-47`). Fix: the status
    half is two calls (`CoCreateInstance(NetworkListManager)`, `g_network_monitor_get_default`); the
    scheme-interception half has no direct WebView2 equivalent and can keep refusing.
16. **`findinpage`** — `src/plugins/findinpage.ts:133`, requires
    `-[WKWebView findString:withConfiguration:completionHandler:]`. On macOS it is `partial` too:
    `clear` refuses because the only selector is private (`findinpage.ts:173`). Fix for both OSes:
    WebView2 `ExecuteScript` / WebKitGTK `webkit_web_view_run_javascript` against
    `window.find()` and a highlight removal, which also gives macOS a public `clear`.

### Tier 4 — n/a or low-value

17. **`positioner`** — `src/plugins/positioner.ts:132`, requires `NSWindow`; measured
    `not-implemented` on all nine placements. Windows has a window adapter that could serve it, but the
    placements are computed in AppKit's bottom-left space, so wiring it as-is would put a `topLeft`
    window at the bottom of the screen (`src/runtime-plugins-other.ts:29-35`). Fix: a y-down
    conversion, or leave the refusal and document it.
18. **`dock`** — `src/plugins/dock.ts:94`, requires `NSDockTile`. Genuinely `n/a` on Windows and
    Linux (no dock tile, no badge). The typed refusal is the right answer; document it as `n/a` so a
    page can branch.
19. **`accessibility`** — `src/plugins/accessibility.ts:110` with per-OS needs at
    `src/plugins/accessibility-requires.ts:27-97` (`IUIAutomation`, `libatk`). Refusing is correct:
    neither tree walk exists in the shim.
20. **`crash-reporter` on Windows and Linux — partial.** `src/plugins/crash-reporter.ts:50-55` needs
    `startCrashGuard()` and `armCrashHandlers()`. Off macOS the guard never starts (`startCrashPart` is
    only called in the darwin branch, `src/runtime-plugins.ts:151`), so `last`, `list`, `report` and
    `clear` all answer "the helper process is not running" — a misleading message, since the reason is
    that no guard was ever started. `configure` answers (`crash-reporter.ts:92`), which is the one
    command with no guard check. Fix: either run `startCrashPart` on every OS (the record format is
    plain TypeScript) or answer the honest `not-implemented`.
21. **`i18n`** — `partial` on both: `load`, `messages`, `translate` and `setLocale` work from a
    catalogue; `locale` refuses (`src/plugins/i18n.ts:68`) only when no catalogue and no configured
    locale exist, and the refusal names `NSLocale` for every OS. Fix: fall back to
    `Intl.DateTimeFormat().resolvedOptions().locale` — no adapter needed — and let the refusal name
    the real requirement.
22. **`deep-link`** — `partial` everywhere. `url` answers `null` by contract; `scheme` refuses until a
    scheme is registered (`src/plugins/deep-link.ts:94`), and that registration is a macOS Info.plist
    merge (`src/packaging/plist.ts:94`). Fix for Windows: `HKCU\Software\Classes\<scheme>`; for Linux:
    a `.desktop` file with `MimeType=x-scheme-handler/<scheme>`.
23. **`updater`** — `partial` everywhere: `check`/`download`/`verify` work, `install`/`relaunch`
    refuse off macOS with `unsupported-platform` (`src/plugins/updater.ts:114,163`). This is honest —
    there is no installer to write — and needs no fix.

## 3. The in-flight window work: how far each adapter reaches

- **Windows `window` is now adapted, uncommitted.** `src/runtime-plugins-other.ts:62-66` wires
  `windowsWindowAdapter()` when `os === "win32"`, so `create`, `close`, `focus`, `setTitle`, `list`,
  `isOpen`, `setSize`/`getSize`, `setPosition`/`getPosition`, `minimize`, `maximize` and their
  read-backs reach Win32 (`src/platform/windows/window-adapter.ts:120-220`).
- **Measured on this machine with `os = "win32"`:** those commands answer
  `unknown-adapter | "no Windows platform is attached"` — the adapter is present and refuses cleanly
  because no `WindowsPlatform` exists here. On a real Windows run the platform registers itself
  (`src/platform/windows/active-platform.ts:19`), so the same call reaches Win32.
- **Still refusing on Windows, by design:** `setAlwaysOnTop`, `isAlwaysOnTop`, `setFullscreen`,
  `isFullscreen`, `setDecorations`, `isDecorated`, `setOpacity`, `opacity`, `setCursor`,
  `setCursorVisible` — each answers `unknown-adapter` naming the member
  (`window-adapter.ts:13-18`). That is honest; they need `GWL_EXSTYLE`, a style save/restore and a
  layered-window alpha to read back.
- **`window-state` works on Windows** once the adapter is wired: `save`/`restore` need exactly
  `getSize`, `getPosition`, `setSize`, `setPosition` (`src/plugins/window-persist.ts:118-130`), and the
  Windows adapter has all four.
- **`positioner` keeps its bare refusal on both OSes, deliberately.** `ADAPTED` now holds only
  `window-state` (`src/runtime-plugins-other.ts:36`), so both arms register **32** namespaces
  (measured) and `positioner.center` answers `not-implemented`, not `unknown-plugin`. The comment at
  `:29-35` gives the reason: the nine placements are computed in AppKit's bottom-left space, so a
  y-down platform would put a `topLeft` window at the bottom of the screen. That is the right call —
  and it matters, because a namespace missing from the registry makes `selectedPlugins` throw
  (`src/runtime-shim.ts:44`), so a config that listed it would fail to boot.
- **Linux has an adapter but no wiring.** `linuxWindowAdapter` exists
  (`src/platform/linux/window-adapter.ts:21`, exported at `src/platform/linux/index.ts:7`) alongside
  `window-chrome-adapter.ts` and `window-state-adapter.ts`, over the untracked
  `45_window_api.c`/`46_window_state_api.c`. But `windowPlugins` returns the bare plugin for every
  non-win32 OS (`src/runtime-plugins-other.ts:63`), so measured Linux `window.setSize` and
  `window-state.restore` still answer `not-implemented`. Smallest fix: the linux arm beside the win32
  one — `createWindowPlugin(linuxWindowAdapter())` plus `createWindowStatePlugin({ native })` — and
  drop `window-state` from `ADAPTED` on linux, or generalise `ADAPTED` to "whichever OS has an
  adapter".
- **The Linux refusal names the wrong platform.** `src/plugins/window-args.ts:15` and
  `src/plugins/positioner.ts:133` hardcode `NSWindow`, so a Linux page is told it needs AppKit. The
  same class of message defect exists in `os.info` (always `NSProcessInfo`) and `i18n.locale` (always
  `NSLocale`). Cheapest fix: a `REQUIRES` map keyed by platform, the pattern `power.ts:67`,
  `screen.ts:174`, `network-status.ts:39` and `accessibility-requires.ts:27` already use.

## 4. Data paths are macOS-shaped on every OS

Six namespaces compute their root from `homedir()` plus `Library/Application Support`, with no
platform branch, so on Windows and Linux they write where nothing looks for app data:

- `src/plugins/window-persist-store.ts:23-27` — `defaultStateRoot`, used by `store`, `database` and
  `window-state` (`src/runtime-plugins.ts:50`).
- `src/plugins/logging.ts:100-106` — `logDirs`, which `os.paths` also reports
  (`src/plugins/os.ts:143`), so the two cannot drift — they are consistently wrong together.
- `src/plugins/crash-reporter.ts:44-46` — the same shape, independently.

Fix: one platform-aware root helper (`%LOCALAPPDATA%` / `$XDG_DATA_HOME` / `~/Library`) and every
caller above uses it. `CRUST_DATA_DIR` already overrides it, so an app can work around this today.

## 5. What is genuinely fine off macOS

Measured `works`, so a blind lane can rely on them: `fs`, `shell`, `sidecar` and `stronghold` — pure
TypeScript or `node:` modules. `store`, `database` and `logging` also run, but write to the macOS path
§4 describes. Plus `screen` and `keychain`, which have real per-OS backends:

- `screen` — `src/runtime-non-darwin.ts:65-82` selects `linuxScreenAdapter()`
  (`gdk_display_get_monitor`) or `windowsScreenAdapter()` (`EnumDisplayMonitors`). Measured on the
  linux arm here: `screen.list` answers `{ok: true, screens: []}` rather than refusing, because the
  adapter is present and no display server is — which is the documented headless answer. Both adapters
  carry an explicit `UNPROVEN ON REAL GTK` / `UNPROVEN ON WINDOWS` note
  (`src/platform/linux/screen.ts:7`, `src/platform/windows/screen.ts:6`), and Windows reports
  `scale: 1` because the shim does not load `GetDpiForMonitor`.
- `keychain` — `src/runtime-keychain.ts:14-29` picks `advapi32` on Windows
  (`src/platform/windows/keychain.ts:32`, including `CredEnumerateW` for `list`) and libsecret on
  Linux (`src/platform/linux/keychain.ts:41`). Linux's adapter has no `list` member, so
  `keychain.list` refuses with the documented hint (`src/plugins/keychain.ts:179-187`); `get`, `set`
  and `delete` work. Smallest fix for that one cell: bind `secret_service_search_sync` in
  `src/platform/linux/keychain.ts` and return the accounts, the way the Windows adapter does with
  `CredEnumerateW`. Both halves are unproven against the real service.
