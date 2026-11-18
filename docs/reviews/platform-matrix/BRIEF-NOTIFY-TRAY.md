# Windows and Linux: `notification` and `tray`

Measured capability matrix, current state:

```
MATRIX.md   notification   macOS partial | Windows refuses | Linux refuses
MATRIX.md   tray           macOS works   | Windows refuses | Linux refuses
```

Both are things a normal app reaches for early — tell the user something happened, put an icon in the
menu bar / system tray. Both are ordinary platform calls.

## What to build

Adapters in `src/platform/windows/**` and `src/platform/linux/**`, behind the existing plugin contracts.
Read `src/plugins/notification.ts` and `src/plugins/tray*.ts` (and their darwin adapters) for the exact
member shape — do not invent one.

1. **Windows notification** — a balloon/toast through the tray icon (`Shell_NotifyIcon` with
   `NIF_INFO`) is the only mechanism that needs no COM toast registration. A real toast needs
   `Windows.UI.Notifications` and an AppUserModelID; if that is out of reach from `bun:ffi`, say so and
   use the balloon, which is honest and works. `requestPermission` has no Windows equivalent — answer
   it truthfully (there is no permission to request) rather than pretending.
2. **Windows tray** — `Shell_NotifyIcon` with `NIM_ADD`/`NIM_MODIFY`/`NIM_DELETE`, a hidden message
   window to receive the callback, and a popup menu (`CreatePopupMenu` + `TrackPopupMenu`) for
   `setMenu`. **The hidden window needs a window class and a WndProc that survives the app's pump** —
   read how the app's existing message loop is built before adding a second one.
3. **Linux notification** — `libnotify` (`notify_notification_new`/`_show`/`_close`) if the library
   resolves, else the `org.freedesktop.Notifications` D-Bus method; say which you chose and why.
   `requestPermission` has no Linux equivalent either.
4. **Linux tray** — `GtkStatusIcon` if the GTK version still ships it (3.x does, deprecated), else an
   `AppIndicator`. `setMenu` takes a `GtkMenu`.
5. **Refuse by name** for any member you cannot do honestly — a tray that silently shows nothing is
   the `autostart` bug again.

## Do not wire

Deliver the adapters and their tests, **and do not edit `src/runtime-plugins-other.ts`** — two other
lanes are registering their own namespaces in that file right now, and a third writer is how an edit
gets lost. Say in your final message exactly which line the registry needs, and it lands in one
reconciling commit.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt` without a
  path list. 200-line cap — split, never trim.
- Every new shim symbol needs a `PREFLIGHT` entry, an `abi-width` verdict where that test exists, and a
  `fake-shim` arm so tests run here. `Shell_NotifyIcon` takes a struct by pointer — build it on the C
  stack, never across `bun:ffi`.
- **You cannot run Windows or Linux.** Label read-from-code claims; the fake shim is the only thing you
  can measure.
- Never `agent-desktop`, never move the cursor, never launch a GUI app, **and never fire a real
  notification** — it takes the screen.
- Run every build and test in the foreground and wait for it inside the same call.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## Own

`src/platform/windows/**` and `src/platform/linux/**`, **new files only**. Other lanes are editing the
Windows window adapter, the dialog adapter and the clipboard/opener adapters in those same directories —
if you must touch a file one of them has modified, append rather than rewrite.

## Prove, and paste the output

- `bun test src/platform/windows src/platform/linux` green, new cases named.
- `bun run test`, `bun check`, `bun run check:lines`.
- What `notification.notify` and `tray.setTitle` answer on each OS once wired, and the exact registry
  line still owed.

Final message under 12 lines: mechanism per OS, what refuses and why, and the one line owed.
