# Butter parity — wave 2, the gaps reading their source found

Cloned at `~/dev/resources/butter-src` (read-only; never run `bun install` or a build there).
`src/plugins/` has 25 plugins. Ours covers most; these four are real gaps, plus one value we
dropped from the material table.

## Lane F — lifecycle events

Butter's `lifecycle` plugin exposes `onActivate`, `onBeforeQuit`, `onWillQuit`, `onReopen`,
`getInfo`. crust's `AppEvent` is only `"ready" | "window-all-closed"`, so an app cannot know it was
brought forward, is about to quit, or was reopened by a dock click.

- Extend `AppEvent` with `"activate" | "before-quit" | "will-quit" | "reopen"`.
- darwin: `applicationDidBecomeActive:`, `applicationShouldTerminate:` (return `NSTerminateLater`
  and answer `replyToApplicationShouldTerminate:` when a listener settles), `applicationWillTerminate:`,
  `applicationShouldHandleReopen:hasVisibleWindows:` — the existing shim already installs a
  delegate, so this is more delegate methods, not a new object.
- A listener that throws must not block quit; name it and quit anyway, the way
  `window-all-closed` already does.
- `app.info()` in the backend returns `{ id, name, version, execPath, packaged }` — Butter's
  `getInfo`.

Files: `src/app-types.ts`, `src/app.ts`, `src/app-loop.ts`, `src/platform/darwin/**` (delegate +
shim), `src/platform/{linux,windows}/**` for the same four where the platform has them (Windows:
`WM_ACTIVATEAPP`; Linux: GTK focus events), tests. A platform with no such concept answers
`not-implemented` naming it rather than faking an event.

## Lane G — screen.list

Butter: `screen.list()` → `[{ id, primary, scale, bounds, workArea }]`. crust has only the *main*
screen's visible frame, inside the positioner.

- New `screen` plugin: `list()` and `primary()`.
- darwin: `[NSScreen screens]`, each `-frame`, `-visibleFrame`, `-backingScaleFactor`, and the
  primary is `[NSScreen screens][0]`. Their `-frame` is in a bottom-left origin; the plugin answers
  top-left page pixels like `positioner` already does, so one coordinate system for callers.
- windows: `EnumDisplayMonitors` + `GetMonitorInfoW`; linux: `gdk_display_get_monitors`.
- A platform that cannot enumerate answers `not-implemented`.

Files: `src/plugins/screen.ts` + fake + tests, `src/platform/darwin/{screen.ts,shim/97_screen.c}`,
`src/platform/windows/**`, `src/platform/linux/**`, `src/runtime-plugins.ts`, one guide page.

## Lane H — power events

Butter: `power.onSleep`, `power.onLock`. crust's `power` is all pull, no push.

- `power` gains two events: `power:sleep` and `power:lock`, plus `power.onSleep/onLock` helpers if
  the plugin shape allows it. A subscriber is registered from the page through one command.
- darwin: `NSWorkspace` `NSWorkspaceWillSleepNotification` and
  `com.apple.screenIsLocked` on `NSDistributedNotificationCenter`.
- A platform without the notification answers `not-implemented`, never a listener that never fires.

Files: `src/plugins/power.ts` + fake + tests, `src/platform/darwin/{power.ts,shim/*}`, runtime wiring.

## Lane I — devtools, and the missing `tabbed` material

Two small ones, no platform rewrite:

1. `crust dev` with a `dev.url` (Vite) gives you HMR but no inspector; a plain-HTML app has neither.
   Butter's `dev` opens DevTools on right-click. On darwin that is
   `-[WKWebView setInspectable:YES]` (macOS 13.3+) plus `_developerExtrasEnabled` on the
   preferences, and only when `crust dev` — never in a built app. Gate it on an env var the dev
   runner sets, exactly as the reload file is, so a built app cannot turn it on.
2. Butter maps `tabbed=4` for `DWMWA_SYSTEMBACKDROP_TYPE`; ours accepts `"vibrancy" | "mica" |
   "acrylic" | "none"`. Add `"tabbed"` to `WindowMaterial`, map it to 4, and refuse it on macOS and
   Linux by name (it is a Windows 11 concept).

Files: `src/config/types.ts`, `src/platform/windows/shim/46_material.c`, `src/platform/darwin/**`,
`src/cli/dev.ts`, tests.

## Proof

Every lane: own tests, `bun check`, `bun run test`, `bun fmt <files>`, `bun run check:lines`, one
parity row each with an honest status, and a guide page where the surface is new. A platform that
cannot do it says so in the row and in the refusal.
