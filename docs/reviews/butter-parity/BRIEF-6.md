# The last four coverage rows

Read `../fix-wave/BRIEF.md`. Source of truth: `docs/agents/butter-coverage.md`, and Butter's own
plugins at `~/dev/resources/butter-src/src/plugins` (read-only, never build there).

These are the rows that still say `partial` for work that is genuinely missing, verified against
Butter's source rather than assumed.

## Lane V — `crash-reporter` accepts a report from the page

Butter (`crashreporter/index.ts:77,88`) lets the **page** submit: `crash:report` writes one record and
`crash:configure` repoints where records go. crust's `crash-reporter` only reads (`last`/`list`/`clear`)
and arms (`install`/`uninstall`), so a caught error in the page — the ordinary case, an `onerror` in a
render loop — has nowhere to go.

- `report({ message, stack? })` → one record in the same store the guard writes, so `last`/`list`
  answer it afterwards. Same layout, same rotation, same 0600.
- `configure({ dir? })` → repoint the record directory, refused outside the app's data root. Butter
  also takes a `url` to POST reports; **do not** add that — a crash reporter that uploads is a
  privacy decision the app makes, not one a plugin makes for it.
- A page-submitted report and a guard-written one must be distinguishable: the record's `type` says
  `webview` versus the guard's own, and the guide says which is which.
- A message over the record cap is truncated, not refused: losing a crash because its stack was long
  is the worst possible behaviour.

Files: `src/plugins/crash-reporter*.ts`, `src/runtime-crash-store.ts` if the writer lives there,
tests, guide row.

## Lane W — the four power events crust does not subscribe to

crust has `sleep` and `lock`. Butter has six: it also emits `wake`, `screensleep`, `screenwake` and
`unlock` (`darwin.m:410-440`, four `NSWorkspace` observers plus two distributed ones).

- Add `wake`, `screensleep`, `screenwake`, `unlock` to `POWER_EVENTS` and subscribe each on darwin:
  `NSWorkspaceDidWakeNotification`, `NSWorkspaceScreensDidSleepNotification`,
  `NSWorkspaceScreensDidWakeNotification`, and `com.apple.screenIsUnlocked` on the distributed centre.
- The existing C unit already registers a sink for two names; extend it rather than adding a second
  observer object, for the same reason lifecycle reuses the deep-link delegate.
- `onWake`/`onScreenSleep`/`onScreenWake`/`onUnlock` on the plugin, matching the existing pair.
- A platform without the notification answers `not-implemented` naming it.

Files: `src/plugins/power*.ts`, `src/platform/darwin/shim/116_power_events.c`, the darwin adapter,
tests.

## Lane X — `logging.configure`

crust's `logging` is `setLevel`/`level`/`write`/`tail` with a fixed path. Butter's `log:configure`
repoints the file and the level in one call. Options:
- add `configure({ file?, level? })` with the same containment rule as everything else (inside the app
  data root unless the config named a path), **or**
- if the existing `setLevel` plus the config's log path already covers it, say so in the row and
  change the verdict to `same` with the command names that do it.

Decide by reading both, then make the row true either way. Do not add a command for symmetry.

Files: `src/plugins/logging*.ts`, tests if a command is added, `butter-coverage.md`.

## Lane Y — flip F2/F4/F5/F8 honestly

Read-only audit of the four rows after V/W/X land: for each, confirm the crust command list is real
(print it from the plugin objects, not memory), then set the verdict. Any row that is genuinely still
short stays `partial` with the reason — the objective is an accurate table, not a green one.

Files: `docs/agents/butter-coverage.md`, and the matching row in
`site/app/docs/reference/parity/page.mdx`.

## Proof

Each lane: own tests, `bun check`, `bun run test`, `bun fmt <files>`, `bun run check:lines`. Lane Y
runs last and its only output is the corrected table.
