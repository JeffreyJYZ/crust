# What actually works on Windows and Linux? A capability matrix, from code

`nativePlugins` returns the **same 32 namespaces on every OS**, because it builds them from the
darwin adapters with a `DarwinPlatform | undefined`:

```
src/runtime.ts:68        darwinPlatform = darwin ? load() : undefined
src/runtime.ts:73        nativePlugins(core, darwinPlatform, …)
src/runtime-plugins.ts   createClipboardPlugin(clipboard.darwinClipboardAdapter())
                         createOpenerPlugin(opener.darwinOpenerAdapter())
                         createOsPlugin(osInfo.darwinOsAdapter())
                         createShortcutsPlugin(shortcuts.darwinShortcutsAdapter())
                         createWindowStatePlugin({ native: windowAdapter })
                         createPositionerPlugin({ native: windowAdapter, … })
                         createMenuPlugin(darwin.darwinMenuAdapter())
                         createThemePlugin(theme.darwinThemeAdapter())
                         createDockPlugin(dock.darwinDockAdapter())
                         createPowerPlugin(power.darwinPowerAdapter())
                         … 32 in total
```

So an app on Windows or Linux sees a namespace that exists and answers something — but that
something is whatever a darwin closure does when the platform behind it is `undefined`. A blind lane
cannot tell a working command from a broken one, and neither can the docs.

**Produce the matrix that answers it.** One row per namespace, three columns (macOS, Windows, Linux),
and a verdict per cell that a reader can act on:

- `works` — the platform backend implements it and the adapter reaches it.
- `broken` — registered but cannot work (say the exact failure: a thrown TypeError, a bad selector,
  `unknown-adapter`, `unknown-window`).
- `not applicable` — genuinely meaningless on that OS (a dock badge on Windows).

For every non-`works` cell, name the file and line and the smallest fix. Rank the whole table by how
badly a normal app needs the thing — `clipboard`, `opener`, `os.info`, `screen`, `window.setSize` and
`window-state` restore outrank `dock` and `menu`.

## How to establish a verdict, honestly

- Read the adapter and the backend it calls. `DarwinPlatform | undefined` means a member that only
  exists on darwin either throws or answers a named refusal — find out which, per member.
- **Where a test can settle it on this machine, write the check rather than guessing** — a registry
  built with `undefined` (the Windows shape) is constructible here, and a call through it reports the
  real error. If you write such a probe, delete it before you finish; the matrix is the deliverable,
  not new tests.
- You cannot run Windows or Linux. Label every cell `read` or `measured`, and never claim a runtime
  observation you did not make.

## Own

`docs/reviews/platform-matrix/MATRIX.md` only. **Do not edit any source file** — a Windows adapter is
being written right now, and the Linux one may follow.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt`.
- Never `agent-desktop`, never move the cursor, never launch a GUI app.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

Final message under 10 lines: how many namespaces work on each OS, and the three worst gaps.
