# Refusals audit (lane C5, fix wave 2)

Scope: every `notImplemented(...)` site in `src/`, plus the transport refusals that turn `{ ok: false, code }` into a page-visible `not-implemented`. Method: `rg -n 'notImplemented\(|not-implemented' src/` and `rg -n 'notImplemented\(' src/ --glob '!*.test.ts'`, then each call site checked against the adapter the runtime actually registers in `src/runtime-plugins.ts`, `src/runtime-non-darwin.ts`, `src/runtime-keychain.ts` and the platform halves.

## Counts

- `rg -n 'notImplemented\(' src/ --glob '!*.test.ts' | wc -l` — **47 before, 47 after**. No refusal was added or removed; the false ones were corrected in place.
- `rg -n 'not-implemented' src/ --glob '!*.test.ts' | wc -l` — **47 before, 47 after**.
- False *reasons* found in `src/`: **8 before, 0 after**. Five fix groups below; four carry a test, the window-label comment is prose only.
- False refusals fixed earlier in this wave and verified here: Linux keychain (`271c0e5`), Windows `keychain.list` (`48_keychain.c:78-80,168` + `src/platform/windows/keychain.ts:71-81`), `screen.list` on Linux/Windows (`src/runtime-non-darwin.ts:66-83`), sidecar spawn (`f71f0cb`).

## Refusals that hold (no change)

- `src/runtime-single.ts:114` — `single-instance.activate` when single instance was skipped for this launch. Holds: no second process exists to raise.
- `src/bridge/server/invoke.ts:76`, `src/bridge/server/failure-status.ts:26-27`, `src/plugins/define.ts:49,58,91` — transport conversions, not capability claims. Hold.
- `src/app-types.ts:70-78` — `unsupportedLifecycle` returns the typed refusal. The code-level claim holds; the page-facing silence is a separate finding below.
- `src/plugins/screen.ts:133`, `src/plugins/positioner.ts:132`, `src/plugins/window-persist.ts:86`, `src/plugins/window-args.ts:15` — no adapter for that namespace. Hold on non-darwin; `screen` no longer holds there (adapter wired this wave).
- `src/plugins/clipboard-contract.ts:74`, `src/plugins/opener.ts:121`, `src/plugins/theme.ts:48`, `src/plugins/menu.ts:76`, `src/plugins/shortcuts.ts:80`, `src/plugins/os.ts:106`, `src/plugins/dock.ts:94` — AppKit/Win32 call absent, bare plugin on non-darwin. Hold.
- `src/plugins/navigation.ts:71`, `src/plugins/navigation-load.ts:33`, `src/plugins/findinpage.ts:133`, `src/plugins/downloads.ts:43`, `src/plugins/network.ts:77` — WebKit delegate absent. Hold.
- `src/plugins/findinpage.ts:173` — `clear` needs `_clearFindIndicator` on macOS. Holds; WebKitGTK has a public `webkit_find_controller_search_finish`, but no Linux find adapter exists, so no false refusal is reachable.
- `src/plugins/tray.ts:44,52`, `src/plugins/notification.ts:83`, `src/plugins/power.ts:75`, `src/plugins/power-subscribe.ts:22`, `src/plugins/network-status.ts:65,84,98`, `src/plugins/crash-reporter.ts:50,52`, `src/plugins/accessibility.ts:110,120`, `src/plugins/accessibility-page.ts:161`, `src/plugins/accessibility-trust.ts:80,88` — absent adapter or notification. Hold.
- `src/plugins/keychain.ts:94` — no adapter on an unknown OS. Holds; darwin, win32 and linux all pass one now.
- `src/plugins/keychain.ts:176` — `list` without an enumerator. Holds on Linux (`secret_service_search_sync` unbound); win32 names `CredEnumerateW` only as a fallback for a caller-supplied adapter that omits `list`.
- `src/plugins/i18n.ts:51,68` — no catalogue or no `NSLocale` adapter. Hold.
- `src/plugins/deep-link.ts:94` — no registered `CFBundleURLTypes` scheme. Holds; a config gap, not a capability.
- `src/plugins/window-label.ts:43` — invoke carried no routing label. Holds; the bridge's token-bound label is authority and is deliberately not used as a routing answer.
- `src/platform/linux/platform.ts:140` — comment on the honest lifecycle refusal. Holds.

## False reasons corrected

- `src/plugins/notification.ts:100-103` — claimed "There is no separate probe to report" for `notification.requestPermission`. False: `-[UNUserNotificationCenter getAuthorizationStatusWithCompletionHandler:]` is exactly that probe. The refusal now names the unbound selector and what an adapter must bind. Test: `src/plugins/notification.test.ts` "a post-only adapter names the unbound permission probe, not a missing API" (red on the old message, green now).
- `src/plugins/network-status.ts:37` — `linux` required "NetworkChangeNotifier from Gdk". False: `NetworkChangeNotifier` is a Chromium class (chromium `net/base/network_change_notifier.h`), not a GDK API. Now names `GNetworkMonitor in GIO (libgio-2.0.so.0, loaded through libgtk-3)`. Test: `src/plugins/network-status.test.ts` pins the new name.
- `src/plugins/dialog.ts:78,95,110` — each said the AppKit shim "does not expose yet" the panel selector. False: the panel shim and `darwinDialogAdapter()` supply all three. The refusals now say no adapter was passed and name the adapter to pass. Test: `src/plugins/dialog.test.ts` "the refusals name the adapter to pass, not a shim that already exposes the panel".
- `src/plugins/keychain.ts:47-52,173` and `src/plugins/keychain-types.ts:63-68` — comments said Windows does not bind `CredEnumerateW`. False since `48_keychain.c:78-80,168` and `src/platform/windows/keychain.ts:71-81`. Comments now name Linux's `secret_service_search_sync` as the only live `list` refusal. Test: `src/plugins/keychain-list.test.ts` "the Windows half binds CredEnumerateW, so its old list refusal is false" drives a fake shim through the real Windows adapter and gets `{ ok: true, accounts }`.
- `src/plugins/window-label.ts:11-14` — doc comment said a label "grants nothing" and the bridge cannot verify it. False since `15392a6`: authority is the label bound to the document token. Corrected; the command still answers only the routing label.

## Findings outside this lane

- `site/app/docs/guides/keychain/page.mdx:53` and `site/app/docs/reference/parity/page.mdx:69` still say Windows `list` is `not-implemented` and "needs `CredEnumerateW`". False — the Windows half binds it. Belongs to the docs lane.
- `src/app-watch.ts:117-125` catches the lifecycle refusal, so a page registering `app.on('before-quit', …)` gets no event and no error. Not a false refusal; a silent one (`platform-gaps.md` #9). Needs the app-event lane.
- `src/plugins/power.ts:75-79` names IOKit for every platform. The refusal holds, but on Linux/Windows it does not say what would have to exist (UPower/logind or `RegisterPowerSettingNotification`). Left as-is: the claim is true, only incomplete.
- `src/plugins/findinpage.ts:174` names a private selector as the only clear. True on darwin; not corrected because no WebKitGTK find adapter exists to make it false.

## Proof

- `bun test src/plugins/notification.test.ts src/plugins/network-status.test.ts src/plugins/keychain-list.test.ts src/plugins/dialog.test.ts src/plugins/dialog-save.test.ts src/plugins/window-label.test.ts src/plugins/plugins.test.ts` — 60 pass, 0 fail, 126 assertions.
- Not proven here: no Windows, Linux or WebKitGTK host, so the Windows `list` and Linux `NetworkChangeNotifier`→`GNetworkMonitor` claims are proven from the bound binding and the adapter's injected fake, not from a live OS call.
