# Windows and Linux: clipboard, opener and `os.info`

Measured across all 32 namespaces: macOS 29 work, Windows 10, Linux 8. The three cheapest wins are the
ones a normal app hits in its first hour — copy a string, open a link, learn its own version.

```
MATRIX.md:64   clipboard   macOS works | Windows refuses | Linux refuses
MATRIX.md:65   opener      macOS works | Windows refuses | Linux refuses
MATRIX.md:67   dialog      macOS works | Windows refuses | Linux refuses   ← another lane owns this
MATRIX.md:82   autostart   macOS works | Windows/Linux broken (SILENT)    ← another lane owns this
```

The refusals come from the adapters being darwin-shaped:

```
src/plugins/clipboard-contract.ts:74   requires NSWorkspace-era NSPasteboard
src/plugins/opener.ts:121              requires NSWorkspace
src/plugins/os.ts:105-109              requires NSProcessInfo
```

## What to build

An adapter per platform per namespace, in the platform directories that already exist:

1. **Windows clipboard** — `OpenClipboard`/`GetClipboardData(CF_UNICODETEXT)`/`SetClipboardData`, with
   `GlobalAlloc(GMEM_MOVEABLE)` for the set path and the open/close pair always closed on every return
   path. Text is the must-have; if `readImage`/`writeImage` cannot be done honestly through the same
   shim, refuse them **by name** rather than answering an empty result.
2. **Linux clipboard** — `gtk_clipboard_get(GDK_SELECTION_CLIPBOARD)` +
   `gtk_clipboard_set_text`. Images are a `GdkPixbuf` round trip; if that is not reachable from the
   current shim, refuse by name.
3. **Windows opener** — `ShellExecuteW` with `"open"` for a path and a URL; `revealItem` is
   `explorer /select,<path>` or `SHOpenFolderAndSelectItems`. Read the exit/return value: `ShellExecuteW`
   answers a value ≤ 32 on failure and it is *not* an error code.
4. **Linux opener** — `g_app_info_launch_default_for_uri` for both a file URI and an http URL; build
   the `file://` URI with the platform's own escaping, not by concatenation.
5. **`os.info` on both** — version, arch, locale and the platform name, from the OS itself
   (`RtlGetVersion` or `GetVersionExW` on Windows; `/etc/os-release` plus `g_get_language_names` on
   Linux). Do not invent a macOS-shaped answer.

Then **register each one** in the same place the window adapters are registered, so a non-darwin run
picks it. Read `src/runtime-plugins-other.ts` and `src/platform/windows/active-platform.ts` first — the
pattern for reaching the platform from the registry already exists.

## Rules

- One tree, no worktree. `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`. Never `bun fmt` without a
  path list. 200-line cap — split, never trim.
- Every new shim symbol needs a `PREFLIGHT` entry, an `abi-width` verdict where the platform has that
  test, and a `fake-shim` arm so tests run on this machine. `OpenClipboard`/`ShellExecuteW` return
  `BOOL`/`HINSTANCE` — widths matter, a wrong one faults instead of failing.
- **Refuse by name where the platform genuinely cannot do it.** A fake success is what put `autostart`
  in the broken-silent column; do not add another.
- **You cannot run Windows or Linux.** Say which claims are read-from-code and which are test-only.
- Never `agent-desktop`, never move the cursor, never launch a GUI app.
- Run every build and test in the foreground and wait for it inside the same call.
- DO NOT WASTE TURNS: batch every independent call, chain dependent steps, never yield between them.

## Own

`src/platform/windows/**` and `src/platform/linux/**` for your adapters, plus the registry wiring for
**your three namespaces only**. Other lanes own `dialog`, `autostart`, the Linux window wiring and
`src/platform/windows/window-adapter*.ts` — do not touch those files.

## Prove, and paste the output

- `bun test src/platform/windows src/platform/linux` green, new cases named.
- `bun run test`, `bun check`, `bun run check:lines`.
- The measured before/after for the three namespaces on both OSes — call them through the registry the
  way the matrix did and show what they answer now.

Final message under 12 lines: what each of the three answers on each OS now, and anything still
refused with the reason.
