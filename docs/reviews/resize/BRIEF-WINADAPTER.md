# Windows: the `window` plugin is bound to the darwin adapter

Found while proving resize on arm64. The runtime chooses the window adapter by OS:

```
src/runtime.ts:68-71     darwinPlatform = attachPlatform && process.platform === "darwin" ? … : undefined
src/runtime.ts:73        nativePlugins(core, darwinPlatform, …)
src/runtime-plugins.ts:139   const windowAdapter = darwin.darwinWindowAdapter(platform)
src/runtime-plugins.ts:171-177  createWindowPlugin(windowAdapter)
                                createWindowStatePlugin({ native: windowAdapter })
                                createPositionerPlugin({ native: windowAdapter, … })
```

On Windows `darwinPlatform` is `undefined`, so every window command is wired to the **darwin**
adapter, which reads `platform.nativeWindow(label)` / `platform.nativeWebview(label)` — members only
`DarwinPlatform` has.

What still works: `app.run()` opens the configured windows through `Platform.createWindow`, which the
Windows backend implements (the arm64 proof shows a real HWND, `window open`, and a `greet` round
trip). What does not: the `window.*`, `window-state` and `positioner` **plugin commands**.

The arm64 workflow had to drive `SetWindowPos` through `bun:ffi` by hand for exactly this reason.

**Determine the real failure shape first, do not assume it.** `window-state.ts:26` answers
`unknown-adapter` only when the member is not a function; a darwin closure *is* a function even with
an undefined platform, so the failure may be a thrown `TypeError` or a bad selector instead. Write a
test that builds the registry the way Windows does and calls the command, and report the actual
error before you change anything.

## What to build

A Windows window adapter, selected by OS in `nativePlugins`, so the same plugin commands work there.

1. **`src/platform/windows/window-adapter.ts`** — implement the members `WindowNative` requires, on
   top of the Windows backend you already have (`frames.ts`, the user32 shim, `window-open.ts`).
   Read `src/plugins/window-state-types.ts` and `src/platform/darwin/window-adapter.ts` for the exact
   shape; implement what the platform can honestly do and **answer `unknown-adapter` by name** for
   anything it cannot, rather than faking it.
2. **Select it by platform** in `nativePlugins` — no `process.platform` branching inside the adapter
   itself; the registry picks the adapter, as it already picks the platform.
3. **Do not change the darwin path.** Its behaviour is pinned by tests and by `e2e:window`.
4. **Tests** — the failure you measured becomes a regression test: the Windows registry answers a
   real result (or a named refusal) where it used to throw, and `window.setSize` on a label that does
   not exist answers `unknown-window` rather than a TypeError.

## Own

`src/platform/windows/**`, `src/runtime-plugins.ts`, and a test for the registry selection. Do not
touch `src/platform/darwin/**`, `scripts/window/**` or `.github/workflows/**` — those are settled.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt` without a
  path list. 200-line cap — split, never trim.
- **You cannot run Windows here.** Say which claims are read-from-code or test-only; never claim a
  runtime Windows observation. The `windows-arm-runtime` workflow is `workflow_dispatch` + `v*` tags
  on `windows-11-arm`, so its verdict comes with a tag, not with you.
- Never `agent-desktop`, never move the cursor, never launch a GUI app.
- Run every build and test in the foreground and wait for it inside the same call.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## Prove, and paste the output

- The measured failure shape **before** your change (the test output, not a description).
- `bun test src/platform/windows src/runtime-plugins*` green, with the new assertions named.
- `bun run test`, `bun check`, `bun run check:lines`.

Final message under 12 lines: the failure shape you measured, the members you implemented, the
members you refused by name and why.
