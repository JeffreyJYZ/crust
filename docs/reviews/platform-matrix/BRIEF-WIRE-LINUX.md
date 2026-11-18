# Wire the Linux window adapter into the registry

`src/platform/linux/window-adapter.ts` landed in `8e5b962` with 31 tests, and it is **not registered**.
Until it is, a Linux app still gets the bare `window` plugin and `window.setSize` still answers
`not-implemented`.

The registry already has the shape to hang it on:

```
src/runtime-plugins-other.ts   otherPlatformPlugins(parts)  →  windowPlugins(os)
                               if (os !== "win32") return [createWindowPlugin()];
```

## What to do

1. **`windowPlugins(os)`** gains the linux arm: `linuxWindowAdapter(platform)` for `os === "linux"`,
   the bare plugin for anything else. It needs the `LinuxPlatform` instance — read how the Windows
   arm gets its platform (`activeWindowsPlatform()` in `src/platform/windows/active-platform.ts`) and
   do the same for Linux **only if that is genuinely the cleanest option**; the alternative is passing
   the platform through from `runtime.ts`, which is now fair game because the Windows lane that owned
   that file has landed. Say which you chose and why in one line.
2. **`positioner`** — check whether the Linux adapter can honestly serve it. If its nine placements
   are computable from GTK's work area, wire it; if not, leave the bare refusal and say so. Do not
   port darwin's bottom-left math into a platform whose origin differs.
3. **Tests** — extend `src/runtime-plugins-windows.test.ts` (or add the linux twin beside it) so the
   linux arm is asserted: `os = "linux"` registers an adapter that answers a real result where it used
   to answer `not-implemented`, and no namespace is registered twice. The existing test already pins
   the win32 arm and that linux stayed bare — that last assertion now changes, deliberately.
4. **Nothing else.** `src/platform/linux/**` is settled and its tests pass; do not rewrite them.

## Own

`src/runtime-plugins-other.ts`, `src/runtime-plugins.ts` (only if the platform must be passed),
`src/platform/linux/active-platform.ts` if you create one, and the registry test file. Do not touch
`src/platform/windows/**` — a lane is editing it right now — and do not touch `src/platform/darwin/**`.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt` without a
  path list. 200-line cap — split, never trim.
- **No GTK on this machine.** The wiring is testable through the fake shim; display behaviour is not.
  Label what you measured.
- Never `agent-desktop`, never move the cursor, never launch a GUI app.
- Run every build and test in the foreground and wait for it inside the same call.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## Prove, and paste the output

- The registry test that now proves the linux arm (output, not a description).
- `bun test src/runtime-plugins* src/platform/linux` green.
- `bun run test`, `bun check`, `bun run check:lines`.

Final message under 10 lines: how the platform reaches the adapter, what `positioner` now does on
Linux, and the test that pins it.
