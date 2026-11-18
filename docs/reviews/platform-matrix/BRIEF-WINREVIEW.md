# Review commit 47415e1 — the Windows window adapter

Read the **committed** diff, not the working tree (a lane is editing those files right now):

```
git show 47415e1 --stat
git show 47415e1 -- src/platform/windows src/runtime-plugins.ts src/runtime-plugins-other.ts
```

It claims: a Windows `window`/`window-state` adapter, a shim with five new user32 pointers and six
functions, OS-based adapter selection, and a self-registering `active-platform.ts` so `runtime.ts`
did not need a new parameter.

Your job is to find what is wrong with it, not to restate what it says.

## What to look for, in this order

1. **Correctness of the Win32 calls** — `GetWindowRect` returns *screen* coordinates including the
   frame; `SetWindowPos` with a rect from `GetWindowRect` and no `SWP_NOMOVE` moves a window by the
   frame thickness every time `setSize` is called. Does `setSize` preserve position exactly, or drift
   by the titlebar on each call? Trace it.
2. **ABI widths** — every declaration in `ffi.ts` against its C prototype in `shim/*.c`. `GetWindowLongW`
   is 32-bit; `GetWindowLongPtrW` is pointer-sized. A mismatch faults rather than failing cleanly.
   Check `abi-width.test.ts` actually covers each new symbol rather than only the old ones.
3. **The lifecycle of `active-platform.ts`** — a module-level singleton set by `createPlatform`. What
   happens when a test builds a platform twice, when `app.run()` is never called, when two apps run in
   one process? Is the singleton cleared on teardown, or does a second `createPlatform` silently
   replace the first adapter's platform while windows from the first still exist?
4. **`runtime-plugins-other.ts`** — it drops `window-state` from `nonDarwinPlugins` for win32 and
   re-registers an adapted one. Prove that no namespace is registered twice and none is missing, for
   **both** `os = "win32"` and `os = "linux"` (the linux arm must still get the bare plugins).
5. **Refusal honesty** — the six refused pairs. For each, is the refusal actually necessary, or is it
   a shortcut? Say which ones a competent Win32 implementation closes cheaply.
6. **Tests that would pass on a broken implementation** — a fake shim that answers whatever the
   adapter asks proves nothing about the argument order. Look for a test that pins the *arguments*
   (`set_frame:40,60,800,600` style) and flag any member whose test only checks the happy-path shape.

## Output

Write `docs/reviews/platform-matrix/WIN-REVIEW.md`: findings ranked by severity, each with file:line,
the mechanism, and the smallest fix. A finding needs a path to reach the bad state — a hypothetical
the code cannot produce is not a finding.

If the code is right, say so plainly and name the two or three things you checked hardest. A review
that invents problems is worse than one that finds none.

## Own

`docs/reviews/platform-matrix/WIN-REVIEW.md` only. Do not edit source; another lane is working in
`src/platform/windows/**` right now.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt`.
- Never `agent-desktop`, never move the cursor, never launch a GUI app.
- You cannot run Windows. Every claim is read-from-code or from a test you ran on macOS; label it.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

Final message under 10 lines: the two worst findings, or "clean" with what you checked hardest.
