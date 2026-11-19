# `src/plugins/menu*`, `tray*`, `dock*` hunt — 06

Scope: `src/plugins/menu.ts`, `menu-spec.ts`, `menu-read.ts`, `tray.ts`, `tray-args.ts`,
`tray-types.ts`, `dock.ts`, their fakes and tests. Read-only source inspection; nothing in `src/`
was edited and no GUI app was launched. Four findings. The brief's theme holds: each of these
plugins is written as if the platform behind the adapter were AppKit, and the assumption leaks
into error payloads, the grammar, and refusal mapping.

## MEDIUM — `dock.progress` reports every `setProgress` refusal as a progress-bar install failure

- where: `src/plugins/dock.ts:151-157` — every `!outcome.ok` from `adapter.setProgress(value)`
  is converted to `notImplemented("dock.progress: the tile's progress bar could not be installed — <reason>", "-[NSDockTile setContentView:]")`.
- what breaks: the adapter's `DockOutcome.ok` is false for *any* refusal, not just "the
  `NSProgressIndicator` could not be installed as the tile's content view". In the shipped
  `darwinDockAdapter` (`src/platform/darwin/dock.ts:86-91`) a false `ok` comes from
  `compiled()` first (`:38-44`, "the dock C unit did not compile") and from `crust_dock_set_progress`
  returning 0 for any reason. So a compile failure, or a plain AppKit rejection, is relabelled as a
  bar-install failure and given `requires: "-[NSDockTile setContentView:]"`, a selector that was
  never involved. This contradicts `dock.badge` (`dock.ts:112-114`), which returns the raw reason as
  a `handler-error` and keeps the distinction the adapter reported.
- how reached: on macOS, invoke `dock.progress` with a valid `value` while the dock C unit fails to
  compile, or while `-[NSDockTile]` rejects the update for a reason other than content-view
  installation. The page receives `not-implemented` naming `setContentView:` and cannot tell a
  missing build from a live OS refusal by branching on `requires`.
- smallest fix: return the adapter's reason as a `DockFailure` (`handler-error`) and reserve
  `not-implemented` / `setContentView:` for the one case the adapter actually flags as an
  unavailable progress bar, or drop the specific selector from `requires` when the reason does not
  name it.

## MEDIUM — the accelerator grammar is the narrowest AppKit subset; common keys are impossible

- where: `src/plugins/menu-spec.ts:5`, `:45-56`, `:68`, `:96` — four modifiers
  (`Cmd/Ctrl/Alt/Shift`), a `+`-split, and a key regex of `/^[!-~]$/`.
- what breaks: the grammar encodes a single printable ASCII `keyEquivalent` plus four
  AppKit-style modifier spellings. Everything else is refused with `bad-accelerator`:
  `CommandOrControl+K`, `Super+K`, `Meta+K` (no single AppKit mask — refused by design at `:55`),
  and also AppKit's own non-printable key equivalents — `Cmd+Return`, `Cmd+Space`, `F5`,
  `Cmd+ArrowLeft`, which are real `NSMenuItem` keys. The `+` character is inside the regex
  range the code claims to accept, but `text.split("+")` at `:68` consumes it, so `Cmd++` becomes
  an empty key token and is refused. The refusal is asserted as intended for `Cmd+Return` in
  `src/plugins/menu-refusals.test.ts:74`, so the narrowness is deliberate, not accidental — but it
  means a page cannot bind ordinary shortcuts even on macOS, the one platform with a menu.
- how reached: any `menu.setAppMenu` or `menu.showContext` carrying one of those accelerators
  returns `{ ok: false, code: "bad-accelerator", part: … }` before reaching the adapter. The
  item is silently absent from the built menu.
- smallest fix: accept named keys (`Return`, `Space`, `F1`-`F12`, arrows, `Escape`) and map them
  to AppKit's key-equivalent constants in the platform adapter, or at minimum document the
  printable-ASCII restriction as a grammar contract rather than leaving it implicit in a regex.

## LOW — macOS-only `not-implemented` payloads are handed to Windows and Linux pages

- where: `src/plugins/menu.ts:75-79`, `src/plugins/dock.ts:93-98`, `src/plugins/tray.ts:43-56`
  and `:51-56` — the `missing()` / `missingTooltip()` helpers set `requires` to `"NSMenu"`,
  `"NSDockTile"`, `"NSStatusBar"`, `"setToolTip:"` and say "AppKit" / "NSApplication" in the
  message. `src/plugins/dock.ts:153-156` likewise names `-[NSDockTile setContentView:]`.
- what breaks: `requires` is a documented API field ("the selector or framework the command is
  waiting on", `src/plugins/define.ts:45-46`), so a page is invited to branch on it. The bare
  `menuPlugin` and `dockPlugin` are registered on non-darwin platforms via
  `src/runtime-non-darwin.ts:51` and `:53` (and survive the non-darwin filter at
  `src/runtime-plugins-other.ts:93-96`), so a Windows or Linux page invoking `menu.*` or `dock.*`
  receives a refusal naming AppKit symbols that do not exist on its OS. The same shape applies to
  `tray.setTooltip` when an adapter omits the setter: the payload names the AppKit selector
  `setToolTip:` even though a non-macOS tooltip would go through a different API.
- how reached: call any `menu.*` or `dock.*` command from a page on Windows/Linux; the registry
  converts the value to a `CrustError` with the macOS `requires` intact
  (`src/plugins/registry.ts:82-84`).
- smallest fix: make the refusal name the concept, not the AppKit symbol, when no adapter is
  present (`requires: "menu"` / `"dock"` / `"tray.tooltip"`), and reserve the selector name for a
  platform that actually exposes it.

## LOW — a menu selection or tray click is dropped when the menu was set through in-process `app.invoke`

- where: `src/plugins/menu.ts:84-87`, `:134`, `:145` (the single `sink` is assigned only when a
  command receives a `ctx`); `src/plugins/tray.ts:108-131` and `src/plugins/tray-args.ts:66-74`
  (`emitClick` captures the `ctx` handed to `setMenu` and returns early when it is absent).
- what breaks: `app.invoke` dispatches plugin handlers through `invokeCommand`
  (`src/app.ts:123-126`), which calls `handler(args)` with **no** second argument
  (`src/plugins/define.ts:80-93`). A host that installs a menu/tray menu this way leaves `sink`
  undefined and `ctx` undefined in the wired `onClick`. The click still calls the in-process
  `onClick`, but the `menu` / `tray:click` event is dropped, so a page listening for selections
  never hears them, even though the docs promise every selection is pushed as an event.
- how reached: from app code, `app.invoke("menu", { command: "setAppMenu", … })` (or the tray
  equivalent), then pick a row. Bridge invocations (`window.crust.invoke`) are unaffected because
  the bridge supplies a long-lived shared `ctx` (`src/bridge/server.ts:45-46`).
- smallest fix: in `invokeCommand`, pass a context with a no-op or bridge-shaped `emit`, or have
  the menu/tray plugins install a begin-of-life context with a stable emitter instead of relying
  on whichever command happened to carry one.
