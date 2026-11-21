# Gap 4 — office documents (docx / xlsx)

The app's verdict has two halves fused into one sentence, and they cost wildly different amounts:
"no docx/xlsx in the page" is **app side, and mostly already paid for**, while "no system QuickLook
in a webview" is a **crust feature on macOS only, with nothing honest to give Windows or Linux**.

## Verdict

1. **Render half — `app side`.** The page can already read the bytes: `fs.readBinary` returns real
   `Uint8Array`s across the bridge, and `dialog.openPanel` already picks the file. Nothing is missing
   from crust for a page-side renderer; the missing thing is a renderer, which is an app dependency.
2. **System-preview half — `crust feature`, macOS only.** `QLPreviewPanel` over `bun:ffi` is the same
   class of work as the panels and delegates crust already drives (dynamic ObjC class, C-side path
   storage, non-blocking poll), so it is buildable. On Windows and Linux the only system "preview" is
   `ShellExecuteW("open", …)` / `g_app_info_launch_default_for_uri` — **an external app, not an
   embedded preview** — and crust already exposes exactly that as `crust:opener`.

## Evidence

- **Bytes already cross, both ways.**
  `src/plugins/fs-binary.ts:75` `readBinary` → `new Uint8Array(await handle.arrayBuffer())` (line 81),
  returned through the `__crustBytes` escape documented at `fs-binary.ts:5-10`, so a page receives a
  real `Uint8Array` rather than a number-keyed object.
  `src/plugins/fs.ts:129` `readTextFile` is the text sibling, `/src/plugins/fs-binary.ts:84`
  `writeBinary`, `:91` `mkdir`.
  Public contract: `site/app/docs/reference/api-fs/page.mdx:13` — "`readBinary` | `{ path }` | the
  file's bytes, as a `Uint8Array`".
- **Scope is the only gate, and it is config, not code.**
  `src/plugins/fs.ts:97-107` (`createFsPlugin` + `scoped`), wired from config at
  `src/runtime-plugins.ts:41-48` (`plugin.name === "fs" && fs?.scope !== undefined` → `createFsPlugin({ allow: fs.scope })`).
  So rendering a user's file needs `fs.scope` to include that folder, or an `openPanel` pick granted
  by the scope store — an app config decision.
- **File picking already exists, with extension filters.**
  `src/plugins/dialog.ts:66` `openPanel`, `:19`/`:35` `filters?: readonly OpenPanelFilter[]`; the
  macOS half is a real sheet that does **not** block the JS thread (`src/platform/darwin/dialog.ts:3`,
  `src/platform/darwin/sheet.ts:15-31` poll loop).
- **No `fs.watch`.** `rg -n "watch" src/plugins/fs*.ts src/plugins/barrel-data.ts` returns nothing, so
  re-rendering after an external edit is `fs.stat` (`src/plugins/fs.ts:168`) polled by the app. Tooling
  gap, not an office gap.
- **macOS already reaches AppKit at the level a preview panel needs.**
  `src/platform/darwin/objc.ts:35` `SEL` (`sel_registerName` through the shim's `shim_sel`), `:100-151`
  the whole guarded `objc_msgSend` table (`p0`…`vq1`, `allocInit` at `:153`), and
  `platform/darwin/appkit.ts:8-37` brings `NSApplication` up with a selector preflight.
- **Runtime-created ObjC classes are an existing capability, not a new trick.**
  `src/platform/darwin/navigation.ts:1-11` — `WKNavigationDelegate` built with
  `objc_allocateClassPair` + `class_addMethod`, kept alive with `objc_setAssociatedObject`, four
  callbacks into JS through one `JSCallback`.
  Same pattern for the download delegate: `src/platform/darwin/shim/downloads/30_api.c:34` (class),
  `:39`/`:46`/`:51` (`class_addMethod`), C unit ids `107_navigation.c` / `downloads/{00,10,20,30}`.
- **Panels that run outside the webview already exist, and they already store paths in C.**
  `src/platform/darwin/shim/60_panels.c:12-15` (`SHIM_PANEL_MAX_PATHS 32`, `panel_paths[32][…]`),
  `:75` the append; `src/platform/darwin/shim/75_open_panel.c` builds and runs `NSOpenPanel`, and
  `src/platform/darwin/dialog.ts:42` picks the class by command. So "a native panel answers from data
  the C side holds, and JS reads it back by index" is a measured crust idiom.
- **A preview plugin has a home in the existing seam.** Adapters are plain objects handed to a plugin
  factory: `src/platform/darwin/opener.ts:151` `darwinOpenerAdapter()`, `src/plugins/opener.ts:59-107`
  `OpenerAdapter` + `createOpenerPlugin(adapter)`, registered at `src/runtime-plugins.ts:162`, with the
  refusing halves at `src/runtime-adapters-other.ts:54` (Windows) and `:73` (Linux).
  `Platform` (`src/app-types.ts:27-51`) needs **no** change — only `start/pump/createWindow/window/destroy/quit`.
- **Absence of any preview surface today.** `rg -ni "QLPreview|QuickLook" --glob '!research/**'` matches
  only `docs/recon/app-gaps/00-brief.md:11`; `rg -ni "preview" src/plugins/*.ts` matches one comment in
  `updater-args.ts:115`; the parity page has no office/preview row
  (`rg -ni "quicklook|preview|docx|xlsx|office" site/app/docs/reference/parity/page.mdx` → empty).
- **The system can actually render the formats, which is what makes the macOS half worth anything.**
  `/System/Library/QuickLook/Office.qlgenerator/Contents/Info.plist` lists
  `org.openxmlformats.wordprocessingml.document` … `.template.macroenabled` and
  `org.openxmlformats.spreadsheetml.sheet` … `.template.macroenabled` (+ presentationml), so
  QuickLook previews docx/xlsx/pptx **with no Office install**. `/System/Library/Frameworks/QuickLookUI.framework`
  is present, so `-framework QuickLookUI` resolves.
- **Windows has no preview verb, only "open".**
  `src/platform/windows/shim/51_opener.c:2-6` — `ShellExecuteW` with the `"open"` verb, "the shell's own
  association lookup"; `:10` `revealItem` is `explorer.exe /select,`. No `IPreviewHandler`, no
  `CoCreateInstance` host anywhere: `rg -n "CoCreateInstance|IPreviewHandler"` over `src` matches only
  `windows/shim/48_dialog.c:3`, a comment saying COM's `IFileOpenDialog` was **avoided** for exactly
  that cost. Explorer's preview pane is a COM preview-host with its own window (`prevhost.exe`), i.e. a
  new subsystem, not a new call.
- **Linux is GIO's default handler, i.e. an external app.**
  `src/platform/linux/shim/81_opener.c:2` — `g_app_info_launch_default_for_uri`, ": what a double-click does";
  `:47`/`:51-66` resolve and launch, `:74`/`:90` path→`file://`. That opens LibreOffice, it does not
  render in-tree. (GNOME Sushi, `org.gnome.NautilusPreviewer`, is a Nautilus D-Bus client — not a
  general API and not a crust path.)

## What it would take

### Render half (app side)

- App: `dialog.openPanel({ filters: [{ name: "Excel", extensions: ["xlsx"] }] })` → `fs.readBinary({ path })`
  → renderer. Config: `fs.scope` must cover the folder, or the pick must be granted.
- Renderer choice is the app's: a docx→HTML renderer (paragraphs, runs, images extracted from the zip)
  and a sheet renderer (grid, merges, number formats, formula results) are different dependencies with
  different fidelity. Crust contributes nothing here and should not.
- Only real crust-side irritations, neither new: a response is **not** size-capped while a request body
  is 2 MiB (`src/bridge/server/body.ts:12`, `MAX_BODY_BYTES`; `src/bridge/server/invoke.ts:109-122`
  only *logs* `bytesOut`), so a 40 MB xlsx goes over the wire base64-inflated — the app should refuse
  or stream by size itself; and no `fs.watch`, so "file changed on disk" is app polling.

### System-preview half (crust feature, macOS)

Smallest honest design, all in the existing seams:

- `src/platform/darwin/shim/125_preview.c` — new translation unit (one id above `124_snapshot_read.c`):
  `shim_preview_available()`, `shim_preview_set_paths(const char *bytes, int len)` (newline-separated,
  stored as a C array exactly like `60_panels.c:15`), `shim_preview_show()`, `shim_preview_hide()`,
  `shim_preview_reason()`, plus a lazily built `CrustPreviewDataSource` via `objc_allocateClassPair` +
  `class_addMethod` for `numberOfPreviewItemsInPreviewPanel:` and `previewPanel:previewItemAtIndex:`,
  returning items from that array (precedent: `downloads/30_api.c:34-51`, `navigation.ts:1-11`).
  Each item is wrapped in a tiny class whose `previewItemURL` IMP returns `+[NSURL fileURLWithPath:]`,
  rather than relying on an NSURL category existing.
- `src/platform/darwin/preview.ts` — `cc()` compile + `darwinPreviewAdapter()`, mirroring
  `opener.ts:65-96` and `:151`, with `flags` gaining `-framework QuickLookUI`.
- `src/plugins/preview.ts` — `createPreviewPlugin(adapter)` in the shape of
  `src/plugins/opener.ts:107`: `show({ path, window? })`, `hide()`, always answering a plain object,
  and `not-implemented` with `requires: "QLPreviewPanel"` where no adapter was passed.
- Registration: `src/runtime-plugins.ts:162` (beside `createOpenerPlugin`), refusing adapters at
  `src/runtime-adapters-other.ts:54`/`:73`. `Platform` unchanged.
- Selectors must be added to `src/platform/darwin/preflight.ts`, or the app aborts at startup by design
  (`appkit.ts:10-16`).
- Tests in the existing fake style (`dialog-fake.ts`, `platform/darwin/panel-fake.ts`), an e2e beside
  `e2e:notify`, one docs page under `site/app/docs/reference/`, and the 200-line cap on every file.

What the user actually sees: **a QuickLook floating panel over the app window** — arrow keys between
files, space/close to dismiss, the same chrome as Finder's spacebar preview. Not a pane inside the page,
and not inside the window's content view.

Cheaper macOS variant worth naming but not recommending: `NSAttributedString` can read `.docx` and be
converted to HTML, which would put Word text in the page with no panel — but it loses layout, has no
xlsx equivalent, and still costs a new shim export, so it buys less for the same seam.

### Windows / Linux

No embedded-preview design exists that crust can absorb at a reasonable size: Windows needs a COM
preview host plus a child HWND; Linux has no agreed API (Sushi is desktop-specific). The honest
cross-platform floor is what ships today — `opener.openPath`, which opens the file in Word /
LibreOffice. Any "preview" command must therefore report `not-implemented` with `requires` on those two
rather than pretend.

Cross-platform alternative, and the cheapest one: convert in a sidecar (pandoc / soffice) through the
existing `shell.spawn` allowlist (`src/plugins/shell.ts:2-4`) and render HTML/CSV in the page. That is
app side, works on all three OSes, and needs no crust work.

## What breaks

- **`QLPreviewPanel` is main-thread only, and crust's run loop runs on a pump timer**
  (`src/app-types.ts:29`). The panel repaints only while the pump ticks, so a page doing long
  synchronous work freezes the preview — a visible failure the app cannot fix.
- **A floating panel outlives a closed window.** `destroy(label)` closes and forgets
  (`src/app-types.ts:37`), so `hide()` must be called on window close, or the preview floats over an
  empty desktop. Same for fullscreen: crust sets `fullScreenPrimary` (window behaviour), and a panel
  that is not reordered joins no Space and is invisible until the app leaves fullscreen.
- **Startup fragility.** Every new selector must be preflighted (`preflight.ts`), which is by design —
  an unguarded `objc_msgSend` on a missing method aborts the process with SIGABRT and no JS error
  (`objc.ts:64-97`).
- **Line cap.** Shim unit + adapter + plugin + fakes + docs can all fit under 200 lines each, but the
  panel semantics (singleton, space, window lifetime, paths array) will push `preview.ts`; split by
  responsibility, never by trimming the comments that record these reasons.
- **The shape risk that matters more than any bug:** one `preview.show` API that only macOS can honour
  invites an app to write a cross-platform "inline preview" promise that degrades to "Word opened" on
  Windows and Linux. `crust:opener` already answers that honestly; a `preview` namespace must refuse
  just as honestly.

## Estimate

- **Render half — app side, S for text, M for faithful sheets.** Bytes, picking and scope all exist;
  cost is the renderer dependency and its fidelity, and none of it belongs in crust.
- **macOS system preview — crust feature, M.** Every primitive already exists (dynamic class, JSCallback
  scalars, C-side path storage, guarded sends, sheet-style polling), but it is a new framework link, a
  new C unit, a new plugin, preflight entries, tests, an e2e and a docs page — and the panel's
  singleton/space/lifetime semantics are where the time goes.
- **Windows / Linux embedded preview — blocked by the platform.** The external-app answer already ships
  (S, and already done).

## What stays the app's job

- Choosing and shipping a docx/xlsx renderer, and the fidelity/performance trade it makes.
- Deciding what "viewing a document" means in its UI: read-only render, edit-through-to-a-sidecar,
  formula results vs formulas, whether macro-enabled files open at all.
- Its `fs.scope` grants, its size policy (the bridge does not cap responses), its refresh-on-change
  polling, and any conversion sidecar it wants to allowlist.
- On macOS, calling `preview.hide()` when the document or window goes away — crust can expose the
  panel, it cannot know when the app is finished with a file.
