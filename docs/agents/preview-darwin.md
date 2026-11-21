# preview — the macOS QuickLook panel (platform half)

Owns `src/platform/darwin/{preview.ts,preview-unit.ts,pump.ts}` and
`src/platform/darwin/shim/{125_preview,126_preview_data,127_preview_observer,128_preview_panel,129_preview_probe}.c`.
The plugin (`src/plugins/preview.ts`), its capability and its config section belong to the plugin lane.

## What is built

- `darwinPreviewAdapter(native?)` with `available()`, `show({path,width?,height?,window?})`, `hide()`,
  `visible()`, `windowNumber()`. Answers a plain object; a refusal is data, never a throw.
- Five C parts, one translation unit compiled by `preview-unit.ts` with `-framework QuickLookUI`,
  `-framework AppKit`, `-framework Foundation`. The panel is the system's singleton
  `+[QLPreviewPanel sharedPreviewPanel]`, never an allocated window.
- Two runtime-built classes (`objc_allocateClassPair` + `class_addMethod`, the download delegate's
  device): `CrustPreviewDataSource` (`numberOfPreviewItemsInPreviewPanel:`,
  `previewPanel:previewItemAtIndex:`), `CrustPreviewItem` (`previewItemURL`, one `int slot` ivar read
  off `ivar_getOffset`), and `CrustPreviewObserver` (`windowWillClose:`).
- Paths cross as newline-separated bytes into a C array (`32 × 2048`), exactly like `60_panels.c`.
- Teardown: `previewWindowClosed(win)` from `window-store.ts`'s `destroy`, and the window-close
  observer for the red-button path, which never reaches `Platform.destroy`. `previewOwnerCheck()` is
  only a last resort.

## Measured traps

- **`-orderOut:` does not hide the panel once the owner window has closed.** Measured on macOS 27:
  after a raw `-close`, `-isVisible` stayed 1 and the panel's pixels stayed on screen; the same send
  before the close works. So the teardown is a `NSWindowWillCloseNotification` observer for that one
  window — the poll is a fallback, not the mechanism.
- **`screencapture -l <window>` replays the last frame of an ordered-out window.** A 64 KB PNG proves
  the panel rendered a document; it does not prove the panel is visible. Hiding is read from
  `-isVisible`/`-isKeyWindow`.
- **A notification name built with `+[NSString initWithBytes:...]` matches.** NSNotificationCenter
  filters by name equality, so the AppKit data symbol is not needed; the observer fires (proved by the
  reason string) and `-orderOut:` lands.
- **`bun:ffi` loses a spread argument list.** `symbols.f(parse())` with `parse()` returning
  `[ptr, len]` passes `0`; the same two values read off an object are passed correctly. Worse, a value
  destructured out of a returned tuple arrives corrupted at the call. Production code reads an object
  (`bytesOf`); tests must too.
- **`platform.ts` was exactly 200 lines**, so the pump had nowhere to grow: the timer and its per-tick
  preview poll moved to `pump.ts`. Any future per-tick work belongs there.
- `bun fmt` has no C parser — shim `.c` files are hand-formatted, and `bun run check:lines` counts them
  against the 200-line cap (hence five parts).

## How it was proved

- `preview-unit.test.ts` drives the real `cc()` unit: two paths in, `probe_count` 2, and each item's
  `-previewItemURL` answering its own file path. No panel is created, so the suite never takes focus.
- Out of process, under `probe-run` (three consecutive clean runs): a real window, a real `.docx`
  built with `ditto`, `show` → `visible true`, panel window, capture 64.9 KB of live pixels;
  `hide` → `visible false`; re-show → `true`; raw `-close` of the window → `visible false`, `owner 0`.
- Not wired yet: `preview.show`'s `fs.scope` containment, the capability, the cross-platform
  `not-implemented` refusal, docs and the e2e all belong to the plugin lane.
