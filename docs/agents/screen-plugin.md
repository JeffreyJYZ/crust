# screen — Lane G (butter parity wave 2)

Butter's `screen.list()` → `screen.list` / `screen.primary`, one coordinate system for callers.

## Built

- `src/plugins/screen.ts` + `screen-fake.ts` + `screen.test.ts`; exported from `barrel-platform.ts`.
- darwin `platform/darwin/screen.ts` + `shim/97_screen.c`: `[NSScreen screens]`, `-frame`,
  `-visibleFrame`, `-backingScaleFactor`, primary = `screens[0]`.
- windows `platform/windows/screen.ts` + `shim/47_screen.c`: `EnumDisplayMonitors` +
  `GetMonitorInfoW`, bound in `12_win32.c` and named in the preflight table.
- linux `platform/linux/screen.ts` + `shim/60_screen.c`: GTK3 GDK monitors.
- `runtime-plugins.ts` registers it everywhere, so a non-darwin platform answers
  `not-implemented` naming its own call rather than `unknown-plugin`.
- Guide `site/app/docs/guides/screen/page.mdx`, nav row, parity row `same`.

## Traps

- **The flip is the only silent mistake.** AppKit is bottom-left y-up, callers read top-left y-down:
  `ceiling - (y + height)` where the ceiling is the *primary's* height, not the display's own. A
  display above the primary answers a negative `y`. Proved via the real `toTopLeft`.
- **`bounds` vs `workArea` must stay distinct** — returning one for both still yields four finite
  numbers; the test asserts the 25pt menu bar and 60pt Dock heights differ.
- **`lParam` in an `EnumDisplayMonitors` callback is one fixed value, not the loop index**, so the
  counter is a static; reading it as the index wrote every display into slot 0.
- **`MONITORINFOEXW.cbSize` must be set** or `GetMonitorInfoW` fails with no reason.
- **`gdk_display_get_monitors` is GTK4's** — the shim loads `libgtk-3.so.0`, so the index pair is it.
- **Windows `scale` answers 1**: per-monitor DPI needs shcore.dll, which the shim does not load.

## Not proved

Windows and Linux have never run against real user32 or a display server. Their tests prove the
arithmetic (ten doubles in, one record out), the drop rules, and that an enumerator which cannot
answer yields an empty list rather than a fabricated display.
