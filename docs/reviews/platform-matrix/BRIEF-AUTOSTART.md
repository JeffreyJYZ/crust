# `autostart` answers `ok: true` on Windows and Linux and writes a macOS plist

This is the worst finding in the capability matrix, because it is the only one that **looks like
success**:

```
MATRIX.md:82   autostart   macOS works | Windows broken (silent) | Linux broken (silent)

src/plugins/autostart.ts:56-58   writes ~/Library/LaunchAgents/*.plist on every OS
```

On Windows that path does not exist, so the write either fails after the plugin has already answered
`ok: true`, or it creates a directory tree nobody reads. Either way the app believes login-start is
armed and it is not. On Linux the same, where the real mechanism is an XDG `.desktop` file in
`~/.config/autostart`.

## What to do

1. **Make the answer true on macOS and honest everywhere else.** Pick one and justify it in a comment:
   - implement the real mechanism per OS — `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` on
     Windows, a `.desktop` file in `~/.config/autostart` on Linux — or
   - refuse by name (`unknown-adapter`-style) with the reason, so a caller can branch.
   Implementing is better if it is honest; a refusal is much better than a lie.
2. **`isEnabled` must agree with what `enable` actually did.** Read the real mechanism back; never
   return the state you asked for.
3. **Find every other place the plugin answers `ok: true` without doing the work.** `disable` and
   `isEnabled` are the obvious siblings.
4. **Tests that would have caught it** — a fake platform whose state root is not macOS-shaped, asserting
   that `enable` does not answer `ok: true` while writing to `~/Library/LaunchAgents`.

## Also in scope, because it is the same bug

The matrix found six namespaces writing **macOS-shaped data paths on every OS** — the state root is
`~/Library/Application Support/...` regardless of platform. `defaultStateRoot` is in
`src/plugins/window-persist-store.ts` and six files import it (`window-persist`, `database-name`,
`fs-scope`, `downloads`, `app-loop`). If the fix is small and local to that one function, do it and
note it; if it needs a wider refactor, **report the shape and leave it** — do not half-migrate paths
that already exist on users' machines.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt` without a
  path list. 200-line cap — split, never trim.
- **Never change an existing on-disk location without a migration or a documented reason** — an app
  that loses its store on upgrade is worse than one with an odd path.
- You cannot run Windows or Linux. Label read-from-code claims.
- Never `agent-desktop`, never move the cursor, never launch a GUI app.
- Run every build and test in the foreground and wait for it inside the same call.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## Own

`src/plugins/autostart*.ts` and, if it stays local, `src/plugins/window-persist-store.ts`. Other lanes
own `src/platform/windows/**`, `src/platform/linux/**`, `src/plugins/dialog.ts`, and the registry.

## Prove, and paste the output

- The test that fails before your change and passes after, quoted.
- `bun run test`, `bun check`, `bun run check:lines`.
- What `autostart.enable` answers on each of the three OSes now.

Final message under 10 lines: what it answers on each OS now, and whether the state-root part was done
or reported.
