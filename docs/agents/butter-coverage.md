# Lane O — Butter's plugin folders, answered shape by shape

Read-only audit. Source: `~/dev/resources/butter-src/src/plugins/` (never built). crust side read at the
command level: every crust list below is that plugin's own `commands` object, printed from
`bun -e 'const m = await import("./src/plugins/index.ts") …'` and from `src/runtime-plugins.ts` — not
from memory.

**The brief says 25 plugins; `index.ts` exports 26.** There are 26 folders and 26
`export { default as … }` lines, and `lifecycle` is the extra one. The table covers all 26 rather than
silently dropping a row to make the count match.

## Verdict key

- **same** — every Butter command has a crust counterpart answering the same question.
- **partial** — a counterpart exists, but at least one Butter command has no crust path; the gap is named.
- **namesake** — a crust plugin owns the name but answers a different question, so the shared name is not coverage.
- **absent** — no crust surface answers this folder.

## Table

| Butter            | Butter's commands                                                                            | crust plugin       | crust's commands                                                                                                             | Verdict            |
| ----------------- | -------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `accessibility`   | `a11y:announce`, `a11y:title`, `a11y:focus`                                                  | `accessibility`    | `announce`, `title`, `focus` beside `trusted`, `prompt`, `elementCount`                                                       | same               |
| `autolaunch`      | `enable`, `disable`, `status`                                                                | `autostart`        | `enable`, `disable`, `isEnabled`                                                                                             | same               |
| `autoupdater`     | `check`, `download`, `install`, `restart`                                                    | `updater`          | `config`, `check`, `download`, `install`, `relaunch`                                                                         | same               |
| `clipboard`       | `read`, `write`                                                                              | `clipboard`        | `read`, `write`, `readImage`, `writeImage`                                                                                   | same               |
| `crashreporter`   | `crash:configure`, `crash:report`, `crash:list`                                              | `crash-reporter`   | `last`, `list`, `clear`, `install`, `uninstall`                                                                              | **partial** (F8)   |
| `database`        | `open`, `close`, `exec`, `query`, `get`                                                      | `database`         | `open`, `close`, `exec`, `query`, `get`                                                                                      | same               |
| `dialog`          | `open`, `save`                                                                               | `dialog`           | `openPanel`, `savePanel`, `cancel`                                                                                           | same               |
| `dock`            | `setbadge`, `bounce`, `setprogress`                                                          | `dock`             | `badge`, `badgeLabel`, `bounce`, `progress`                                                                                  | same               |
| `downloads`       | `start`, `cancel`, `list`, `onProgress`                                                      | `downloads`        | `list`, `start`, `cancel`, `directory`, `setDirectory`; events `download:started`, `:progress`, `:finished`, `:failed`       | same               |
| `findinpage`      | `find:start`, `find:stop`                                                                    | `findinpage`       | `search`, `next`, `previous`, `clear`                                                                                        | same               |
| `fs`              | `read`, `readbinary`, `write`, `writebinary`, `exists`, `mkdir`, `readdir`, `remove`, `stat` | `fs`               | `readTextFile`, `writeTextFile`, `readBinary`, `writeBinary`, `list`, `stat`, `remove`, `rename`, `mkdir`, scope commands     | same               |
| `globalshortcuts` | `shortcut:register`, `:unregister`, `:triggered`                                             | `shortcut`         | `register`, `unregister`, `unregisterAll`, `isRegistered`, `list`; event `shortcut`                                          | same               |
| `i18n`            | `init`, `t`, `locale`, `all`                                                                 | `i18n`             | `locale`, `setLocale`, `messages`, `translate`, `load`                                                                       | same               |
| `lifecycle`       | `getinfo`, `activate`, `reopen`; pushes `beforequit`, `willquit`                             | `app` (namespace)  | `app.info()`, `app.invoke`; `app.on(...)` backend plus page events `app:activate`, `app:before-quit`, `app:will-quit`, `app:reopen` | same        |
| `logging`         | `log:write`, `log:configure`                                                                 | `logging`          | `setLevel`, `level`, `write`, `tail`                                                                                         | partial (F2)       |
| `navigation`      | `back`, `forward`, `reload`, `loadurl`                                                       | `navigation`       | `start`, `stop`, `state`, `reload`, `goBack`, `goForward`, `loadUrl`                                                        | same               |
| `network`         | `network:status`; pushes `network:change` (online probe)                                     | `network`          | `status`, `onChange` (`SCNetworkReachability` path + `network:change`); `rules`, `setRules`, `log`, `clearLog` (`WKURLSchemeHandler` interception) | same               |
| `notifications`   | `notify:send`                                                                                | `notification`     | `requestPermission`, `notify`                                                                                                | same               |
| `power`           | `power:idle`, `screen:list`; pushes sleep/wake/screensleep/screenwake/lock/unlock            | `power` + `screen` | `state`, `idleSeconds`, `sleepPrevent`, `sleepAllow`, `onSleep`, `onLock`; `screen.list`, `screen.primary`                   | **partial** (F4)   |
| `securestorage`   | `set`, `get`, `delete`                                                                       | `keychain`         | `set`, `get`, `delete`, `list`                                                                                               | same               |
| `shell`           | `openurl`, `openpath`, `showinfolder`                                                        | `opener`           | `openUrl`, `openPath`, `revealItem`                                                                                          | same               |
| `sidecar`         | `list`, `spawn`, `write`, `kill`; pushes `stdout`/`stderr`/`exit`                            | `sidecar`          | `spawn`; events `sidecar-stdout`, `sidecar-exit`                                                                             | **partial** (F5)   |
| `singleinstance`  | `singleinstance:isleader`                                                                    | `single-instance`  | `acquire`, `release`, `activate`                                                                                             | same               |
| `store`           | `get`, `set`, `delete`, `keys`, `clear`, `flush`, plus named stores                          | `store`            | `get`, `set`, `delete`, `keys`, `clear`, `save`, each with optional `{ name }` → one `store.<name>.json` per store + default `store.json` | same               |
| `theme`           | `theme:get`; pushes `theme:changed`                                                          | `theme`            | `current`, `set`, `reset`; pushes `theme:changed`                                                                            | same               |
| `tray`            | `tray:set` (title, tooltip, items), `tray:remove`                                            | `tray`             | `setTitle`, `setMenu`, `setTooltip`, `show`, `hide`, `destroy`                                                              | same               |

## Findings

**F0 — `fs`: no binary read/write and no `mkdir`.** Butter has `fs:readbinary`/`fs:writebinary`
(base64 in and out) and `fs:mkdir`; crust's `fs` is text-only plus `list`/`stat`/`remove`/`rename`.
`writeTextFile` refuses a `Uint8Array` and there is no way to create a directory, so an app writing an
image has to reach past the plugin. `fs:exists` maps onto `stat` (`not-found` is the false case),
which is a naming difference rather than a gap.

**Closed by Butter-parity Lane T (2026-11-17):** `fs.readBinary` returns a `Uint8Array` (the bridge
tags it `__crustBytes` and the page revives it); `fs.writeBinary` accepts real bytes or that same tag
in a JSON argument; `fs.mkdir` is recursive. All three reuse the one `scoped()` helper, so no second
containment rule exists. `src/plugins/fs-binary.ts` + `fs-binary.test.ts`; lane report
`docs/agents/fs-binary.md`.

**F0b — `network` was a namesake, and now answers both questions.** Butter's `network` answers "is this
machine online" and pushes `network:change`; crust's `network` is request interception over a
registered scheme. Neither is a degraded version of the other, so the fix added the missing pair
rather than bending the interceptor: `status()` reads `SCNetworkReachability` and reports
`{ online, interfaceKinds }`, `onChange()` schedules the same target on the main run loop and emits
`network:change`. The interceptor's `rules`/`setRules`/`log`/`clearLog` are untouched — a rule list
still only sees `crust-net`, and the guide says plainly that the two answer different questions.

**F1 — `lifecycle`: closed by Lane R.** `app.on`/`app.info()` are the backend half. The page half is
now `subscribePageEvents`: `watchLifecycle` publishes `app:activate`/`app:before-quit`/
`app:will-quit`/`app:reopen` from the same loop that awaits `app.on` listeners, so the two cannot
drift. The `app` namespace gained an `info` command beside `invoke`, and either one arms the sink —
`app.info()` is a command, not an `app:info` event, because it has no moment to happen.

**F2 — `logging`:** the level filter is equivalent, but Butter's `log:configure` also picks the file
path at runtime. crust fixes the sink to `<app data>/logs/app.log` with rotation (`logDirs`), and
`setLevel` is the only knob. Not a regression, just a narrower surface — an app wanting its own path
has to move the whole data root.

**F3 — `navigation`:** no `loadUrl`. Butter's `nav:loadurl` drives the webview to an arbitrary URL;
crust's `window.create` accepts `url` but no open window can be pointed somewhere new, so reload of
the current document is the only navigation a page can cause. The adapter (`NavigationAdapter`) has
`state`/`reload`/`goBack`/`goForward` and nothing to load a target.

**F4 — `power`:** two of six push events. `POWER_EVENTS` is `{ sleep, lock }` only, so `wake`,
`screensleep`, `screenwake` and `unlock` have no counterpart even though AppKit reports all six.

**F5 — `sidecar`:** `spawn` only, and no stdin. `bunSpawn` passes `stdin: "ignore"`, so Butter's
`sidecar:write` (feed a daemon a line) has no path at all, and `sidecar:list` (declared names) and
`sidecar:kill` (stop one by id) are missing too — the `running` set is tracked but never exposed.

**F6 — `store`:** crust is one JSON object per app id; Butter's commands all take an optional store
`name`, so an app with several logical stores has no mapping. `save` is Butter's `flush`.

**F7 — `tray`:** no tooltip. `TrayOptions.tooltip` exists in `tray-types.ts` but the interface itself
says nothing reads it, and `TrayNative` has no setter, so a tooltip dropped today is silently lost.

**Closed by Butter-parity Lane U (2026-11-17):** `tray.setTooltip({ text })` is live; the native
setter is optional on `TrayNative`, so an adapter without it answers `not-implemented` naming
`setToolTip:` rather than dropping the text. `navigation.loadUrl({ url, label? })` is live; an
adapter without a load path answers `not-implemented` naming `loadRequest:`. Every `store` command
takes optional `{ name }`: the empty name is `store.json`, a named one is `store.<name>.json`, with
traversal-style names refused before they become a path (one scope per name, cached). Files:
`src/plugins/{tray,navigation,store}*.ts` + per-surface tests; lane report `docs/agents/small-gaps.md`.
The darwin native setters (`status_bar/*.c` `setToolTip:`, `shim/109_navigation_state.c`
`loadRequest:`) are a separate platform task — the plugin answers by name until they land.

**F8 — `crashreporter`:** two different models. Butter's `crash:report` takes a message and stack the
_page_ caught (`window.onerror` is wired in its webview script) and `crash:configure` points at a
directory or a report URL; crust records faults from a separate guard process and reads them back, so a
page-thrown error is not recorded at all and there is no upload endpoint. `clear` and `uninstall` are
crust-only, and `crash:report`'s page half is the gap.

**F9 — `accessibility` was a namesake in the opposite direction.** Butter's plugin is a _page_ helper:
ARIA live regions, `document.title`, and focusing a selector, all executed inside the webview. crust's
`accessibility` asked the OS whether the app is trusted and counted the window's AX children. Both are
real, and the page-facing trio is now covered by platform calls rather than a DOM shim — see the
close-out below.

**Closed by Butter-parity Lane P (2026-11-17):** `announce({ text, priority? })`,
`title({ text, label? })` and `focus({ label? })` are live beside the trust probe, so the row is `same`.
`announce` posts `NSAccessibilityAnnouncementRequestedNotification` through
`NSAccessibilityPostNotificationWithUserInfo` (`shim/106_accessibility_page.c`), `title` applies
`-setAccessibilityLabel:` and leaves `-setTitle:` alone, and `focus` sets `AXFocusedWindow`/`AXFocused`
then posts both change notifications. `announce` is **not** gated on `trusted`: an untrusted process still
posts and the OS drops it, so the answer is `announced: true` with `trusted` beside it. Linux and Windows
refuse by name (`gtk_widget_announce` — GTK 4 only, while the shim loads `libgtk-3.so.0` — and
`NotifyWinEvent EVENT_OBJECT_LIVEREGIONCHANGED`, which is a live-region change and not a request to
speak). Files: `src/plugins/accessibility{,-types,-trust,-requires}.ts`,
`src/platform/darwin/accessibility{,-page-ffi}.ts`, `shim/106_accessibility_page.c`, tests
`src/plugins/accessibility-announce.test.ts` + `src/platform/darwin/accessibility-page.test.ts`, lane
report `docs/agents/a11y-announce.md`. It is not an ARIA live region: nothing enters the DOM, so a page
that wants Butter's exact clear-and-set timing cannot get it back.

## Two claims in the other briefs this audit contradicts

- **BRIEF-4 Lane M says "Butter's `dock` accepts an image path for the badge."** It does not:
  `dock/index.ts` takes `{ text }` and calls `dock:setbadge` with a string, and the AppKit side is
  `setBadge` text. An image badge is a Butter absence, not a Butter behaviour crust fails to match.
- **BRIEF-4 Lane N says Butter's `i18n` "loads `locales/*.json` from the project".** It does — but only
  through `i18n:init({ dir })`; crust now matches it with
  `i18n.load({ directory })`, so the row is `same` rather than a gap.

## Re-checking this table

```sh
bun -e 'const m = await import("./src/plugins/index.ts"); for (const k of Object.keys(m)) { const p = m[k]; if (p && p.commands) console.log(p.name, Object.keys(p.commands).join(", ")); }'
rg -o 'ctx\.on\("([^"]+)"' -r '$1' ~/dev/resources/butter-src/src/plugins/*/index.ts | sort -u
```

The first prints the crust command set, the second Butter's. A row is stale the moment either list moves.
