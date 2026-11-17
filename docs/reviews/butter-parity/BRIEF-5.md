# Closing the eight partials the coverage audit found

Read `../fix-wave/BRIEF.md` first. Source of truth is `docs/agents/butter-coverage.md` — that table
was built by reading both trees command by command, so each row names exactly what is missing.

Every lane here flips one `partial`/`namesake` row to `same` in
`site/app/docs/reference/parity/page.mdx`, and adds the surface Butter has. Nothing here may break an
app that does not use the new command.

## Lane P — `accessibility` is a namesake, not an equivalent

Butter's is a **page-facing announcement surface**: `a11y:announce`, `a11y:title`, `a11y:focus`. crust's
is only a trust probe (`trusted`, `prompt`, `elementCount`), which tells you whether the OS will
expose the tree — not how to speak through it.

- `announce(text, { priority })` → macOS `NSAccessibilityPostNotificationWithUserInfo` with
  `NSAccessibilityAnnouncementRequestedNotification`; Linux `gtk_widget_announce` if the GTK version
  has it, else `not-implemented`; Windows `NotifyWinEvent` with `EVENT_OBJECT_LIVEREGIONCHANGED` is not
  a real announcement, so refuse by name.
- `title(text)` → set the window's accessible name (macOS `setAccessibilityLabel:`), which is what a
  screen reader reads on focus.
- `focus(label)` → move VoiceOver/NVDA focus to a window.
- A truthy `trusted: false` is not a reason to refuse `announce`; the OS drops it, and the answer
  should say so rather than pretend.

Files: `src/plugins/accessibility*.ts`, `src/platform/darwin/accessibility*.ts` + a shim part,
`src/platform/linux/**`, `src/platform/windows/**`, tests, guide page.

## Lane Q — `network` is a namesake: status and change

Butter: `network:status` and a `network:change` push event. crust: only the `WKURLSchemeHandler`
interceptor, which is a different feature that happens to share the name.

- `status()` → `{ online, interfaceKinds }`, from `SCNetworkReachability` on macOS (or
  `NWPathMonitor`), `NetworkChangeNotifier` on Linux via GDK, `NetworkListManager` on Windows.
- `onChange()` → subscribe, emitting `network:change` with the new status.
- **Do not** conflate it with the interceptor: keep `rules`/`log` as they are, add the two commands
  beside them, and say in the guide that they answer different questions.
- A listener that cannot be installed answers `not-implemented` naming the platform call.

Files: `src/plugins/network*.ts` (split if it passes 200 lines), platform shims, tests, guide.

## Lane R — the `app:` events never reach the page

`app.on` works in the backend, but a page cannot hear `activate`/`before-quit`/`will-quit`/`reopen`,
because nothing emits them through the bridge. Butter's whole `lifecycle` plugin is page-side.

- Bridge `app:` prefix events from the runtime: when the lifecycle watch fans an event out, also
  `ctx.emit("app:activate", …)` so a page's `crust.listen` hears it.
- One place — the same watch that already calls `app.on` listeners — so the two cannot drift.
- `app.info()` also reachable from a page: an `app:info` event or a `lifecycle` plugin command. Pick
  one and say why.

Files: `src/app.ts`, `src/app-loop.ts`/`src/app-watch.ts`, `src/runtime-plugins.ts`, tests.

## Lane S — `sidecar`: write, list, kill

crust has `spawn` only, and `stdin: "ignore"`, so a child that needs input cannot be driven.

- `write(id, data)` → the child's stdin, opened as a pipe; `spawn` gains `stdin: "pipe"` and the
  handle keeps it.
- `list()` → every live child with `{ id, name, pid, startedAt }`.
- `kill(id)` → SIGTERM then SIGKILL after a bounded grace, and the exit event still fires once.
- An unknown id is a typed failure naming it, never a silent no-op.

Files: `src/plugins/sidecar*.ts`, tests.

## Lane T — `fs`: binary read/write and mkdir

Butter has `readbinary`/`writebinary`/`mkdir`; crust has text only, so a page cannot move an image.

- `readBinary(path)` → `Uint8Array` (the bridge already carries bytes, `__crustBytes`).
- `writeBinary(path, bytes)` → same scope check as the text write, no new containment rule.
- `mkdir(path)` → recursive, inside scope.
- Both go through the existing `scope.check`, because a second containment rule is how the last
  symlink escape happened.

Files: `src/plugins/fs.ts` (split if needed), `fs-scope*` if a helper is missing, tests.

## Lane U — the three small ones

One lane because each is a few lines in a different file:

- `tray`: `setTooltip(text)` — macOS `setToolTip:`, others `not-implemented` by name.
- `navigation`: `loadUrl(url)` — the interceptor already knows how to start a load.
- `store`: **named stores** — `store.get(key, { name })` or a `named(name)` handle, so two features
  can keep separate keys without prefixing strings. One file per store under the app data root.

Files: `src/plugins/tray*.ts`, `src/plugins/navigation*.ts`, `src/plugins/store*.ts`, tests each.

## Proof

Each lane: own tests, `bun check`, `bun run test`, `bun fmt <files>`, `bun run check:lines`, the
parity row flipped, and `docs/agents/butter-coverage.md` updated from `partial` to `same` for its row
with the command list it now actually answers.
