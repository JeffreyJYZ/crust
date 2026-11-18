# Linux: give the `window` plugin an adapter of its own

The `window`, `window-state` and `positioner` plugins are wired to the **darwin** adapter on every
OS (`src/runtime-plugins.ts:139` builds `darwinWindowAdapter(platform)` and every window-shaped
plugin receives it). On Linux the platform behind it is a `LinuxPlatform`, so those members cannot
work even though GTK can do every one of them.

A Windows adapter is being written concurrently. **Build the Linux one the same way, but do not wire
it** — `src/runtime-plugins.ts` belongs to the other lane. Deliver the adapter plus its tests, and
say in your final message that the wiring is one line left for whoever lands second.

## What to build

1. Read the exact shape you must satisfy: `WindowNative` in `src/plugins/window-state-types.ts` (or
   wherever it lives), and `src/platform/darwin/window-adapter.ts` as the reference implementation.
2. `src/platform/linux/window-adapter.ts` — implement it over the GTK shim and the existing Linux
   backend (`src/platform/linux/backend.ts`, `shim-ffi.ts`, `shim/40_window.c`). Check what the shim
   already exposes before adding a symbol; `gtk_window_*`, `gtk_widget_*` and the screen calls are
   likely already resolved there.
3. **Answer `unknown-adapter` by name for anything GTK cannot honestly do**, rather than returning a
   plausible fake. A command that lies is worse than one that refuses: it is what makes a blind lane
   write code that silently does nothing.
4. Labels map to GTK windows the way `backend.ts` already tracks them — reuse that map, do not build
   a second one.
5. Tests with the fake shim the other Linux tests use (`backend.test.ts` and the `*-fake` helpers
   show the pattern): every member you implement gets a case, and every refusal names the member.

## Own

`src/platform/linux/**` only. Do not touch `src/runtime-plugins.ts`, `src/platform/darwin/**`,
`src/platform/windows/**`, `scripts/**` or `.github/**`.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt` without a
  path list. 200-line cap — split, never trim.
- **There is no GTK on this machine.** Nothing here compiles or runs against real GTK; say so, and
  make the tests exercise the adapter through the fake shim, which is the only thing you can measure.
- Never `agent-desktop`, never move the cursor, never launch a GUI app.
- Run every build and test in the foreground and wait for it inside the same call.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## Prove, and paste the output

- `bun test src/platform/linux` green, with your new cases named in the output.
- `bun check`, `bun run check:lines`.
- The member list you implemented, and the member list you refuse by name.

Final message under 12 lines: the members implemented, the members refused and why, and the one line
of wiring still owed.
