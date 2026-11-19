# Lane C — parity audit

Read-only. Every line below is read from the tree, not run. Nothing was launched, so no AppKit
behaviour is claimed as measured; each claim is a citation of what the code sends.

## Q1 — does `crust dev` build its window through the same `createNativeWindow`?

**Yes. One path, and a built `.app` and `crust dev` differ in nothing that touches the window.**

- `crust dev` spawns the framework's own runtime, the same file a build's wrapper imports:
  `src/cli/dev/runtime.ts:39` — `join(crust, "src/runtime.ts"),`
  (`src/cli/dev/runtime.ts:35-44`: `cmd: generated === undefined ? [ ...run.command, join(crust, "src/runtime.ts"), "--config", options.configPath, "--entry", options.entry ] : [...run.command, generated],`).
- When a project has extensions, dev writes an entry that imports the same `startApp`:
  `src/cli/dev/entry.ts:37` — `` `import { startApp } from ${JSON.stringify(options.runtimePath)};` ``
  with `runtimePath` set at `src/cli/dev/runtime.ts:72` — `runtimePath: join(crust, "src/runtime.ts"),`.
  The header states it outright: `src/cli/dev/entry.ts:15` — `/** The framework's `src/runtime.ts`, so both paths call the same `startApp`. */`.
- Single-file mode is the same again: `src/single-runner.ts:22` —
  `` `import { startApp } from ${JSON.stringify(join(root, "src/runtime.ts"))};` ``.
- Both modes open windows through the config list, never a bespoke creator:
  `src/app.ts:157` — `openWindows(platform, config, this.#bridge);`
  `src/app-loop.ts:138` — `platform.createWindow({`
- The darwin adapter's `create` is a delegate and adds no native work of its own:
  `src/platform/darwin/window-adapter.ts:68` — `return platform.createWindow({ ...options, url: resolveDocument(options.url) });`
  (comment at `:12`: "`create` is `DarwinPlatform.createWindow` and nothing else").
- The platform calls the one constructor: `src/platform/darwin/platform.ts:108` —
  `const pointers = createNativeWindow(label, options, activation);`
- `createNativeWindow` is the only caller of `shim_window_new` anywhere in `src/`:
  `src/platform/darwin/window-create.ts:52` —
  `const win = Number(shim().symbols.shim_window_new(120, 120, width, height, style, 2n, 0));`
  (a whole-tree `rg shim_window_new src scripts` returns only this darwin call; the Windows and Linux
  hits are other platforms' `src/platform/windows/window-open.ts:77` and `src/platform/linux/backend.ts:109`).
- Sheets and dialogs build no window: `rg -n "NSWindow|NSAlert|shim_window" src/platform/darwin/sheet.ts src/platform/darwin/dialog.ts`
  returns nothing.
- The runtime-created window (`window.create` from a page) is the same path too, not a second one:
  `src/plugins/window-create.ts:79` — `create.call(native, options);` where the adapter's `create` is
  the `platform.createWindow` above; its own refusal message says so at `src/plugins/window-create.ts:38-39` —
  "`darwinWindowAdapter(platform)` must delegate it to `DarwinPlatform.createWindow(options)`".

What dev does differ in is diagnostics only: devtools is gated on the env flag dev sets
(`src/platform/darwin/window-create.ts:80` — `if (devInspectEnabled()) shim().symbols.shim_webview_enable_devtools(web);`),
and the activation comment names dev as the harder case (`src/platform/darwin/window-create.ts:134` —
"which is exactly how `crust dev` runs"). Neither writes the style mask or collection behaviour.

**Verdict:** there is no second darwin window path. A fix in `window-create.ts` reaches dev, a built
`.app`, single-file mode and `window.create` alike.

## Q2 — does anything else take fullscreen away after creation?

**Nothing found.** The create-time collection behaviour is the only write of it in the tree, and no
other code re-derives or rewrites the style mask, resizability, movability or fullscreen state at boot.

- The only sender of `setCollectionBehavior:` in `src/` is the create path:
  `src/platform/darwin/window-create.ts:144` — `S.vq1(win, "setCollectionBehavior:", 257);`
  (`rg -n "setCollectionBehavior|collectionBehavior" src` returns this line plus its declaration at
  `src/platform/darwin/preflight.ts:42` — `["NSWindow", "setCollectionBehavior:"],` — which preflights the
  selector and sends nothing; other hits are `spike/`, `research/` and `docs/`).
- The C constructor passes the mask through untouched, so nothing is OR-ed in behind JS:
  `src/platform/darwin/shim/40_window.c:18-20` —
  `return ((obj_t (*)(void *, void *, shim_rect, long long, long long, int))objc_msgSend)(w0, sel_registerName("initWithContentRect:styleMask:backing:defer:"), r, style, backing, defer);`
- The one `setStyleMask:` sender exists for the decorations command, and it re-derives from the live
  mask instead of replacing it: `src/platform/darwin/window-chrome-adapter.ts:35-38` —
  `const mask = sends.styleMask(win);` / `const next = value ? mask | TITLE_BAR_MASK : mask & ~TITLE_BAR_MASK;` /
  `sends.setStyleMask(win, next);`, reaching `src/platform/darwin/window-chrome.ts:43` —
  `S.vq1(win, "setStyleMask:", mask);`. It is only reached from the plugin's `setDecorations`
  (`src/plugins/window-chrome.ts:68-78`), and there is no `decorations` config key to apply at boot
  (`rg -n decorations src/config* src/*.ts` returns nothing outside the plugin), so no boot-time write.
- No `setResizable`, `setMovable`, `setFullScreen:` or `NSWindowStyleMaskFullScreen` writer exists in
  `src/`. The fullscreen API is a flip, not a stored state, and is command-driven only:
  `src/platform/darwin/window-state-adapter.ts:36-39` —
  `setFullscreen(label, value) { const win = require(label); if (sends.fullscreen(win) !== value) sends.toggleFullscreen(win); }`,
  sent through `src/platform/darwin/shim/92_window_state.c:62` —
  `((void (*)(void *, void *, void *))objc_msgSend)(win, sel_registerName("toggleFullScreen:"), ...)`.
  The plugin surface that reaches it is `src/plugins/window-state-toggles.ts:31-40` (`setFullscreen`),
  i.e. a page's own invoke.
- The persisted-frame plugin restores size and position only, never fullscreen or a mask:
  `src/plugins/window-persist.ts:140-142` — `setSize.call(native, label, { width: frame.width, height: frame.height });` /
  `setPosition.call(native, label, { x: frame.x, y: frame.y });`, with the restore arm at
  `src/plugins/window-persist.ts:161-168`. Nothing calls it automatically: `rg -n "restore\(|window-state"`
  over `src/runtime.ts`, `src/app-loop.ts`, `src/runtime-plugins.ts` and `src/app.ts` returns nothing.

**Verdict:** no second writer. A corrected value at `window-create.ts:144` survives for the life of the
window unless the page itself invokes `window.setDecorations` or `window.setFullscreen`.

## Cross-platform check — is darwin missing a create-time step?

- **Windows** sets no fullscreen bit at create: `src/platform/windows/shim/40_window.c:11` —
  `hwnd = CreateWindowExW(0u, clsBuf, titleBuf, SHIM_WS_OVERLAPPEDWINDOW, ...)` with
  `src/platform/windows/shim/10_prelude.c:74` — `#define SHIM_WS_OVERLAPPEDWINDOW 0x00CF0000u`.
  Fullscreen there is a runtime rewrite that saves the previous style and frame and restores them:
  `src/platform/windows/window-fullscreen-adapter.ts:17` — `/** `WS_POPUP`, the bit a borderless fullscreen window carries. */`,
  `:39` — `const fullscreen = new Map<number, Saved>();`, and the save/apply pair at `:67-80`.
- **Linux** delegates to GTK, again only on command: `src/platform/linux/shim/45_window_api.c:70` —
  `API(api_fullscreen, "gtk_window_fullscreen")`, driven by
  `src/platform/linux/window-state-adapter.ts:45` — `gate("setFullscreen", () => sends.setFlag(require(label), "fullscreen", value));`,
  and read from GDK state bits at `src/platform/linux/window-sends.ts:18` — `fullscreen: 1 << 4,`.
- Neither platform carries a fullscreen entitlement in the create style, so no platform implies darwin
  is missing a style bit at creation. Darwin's create mask already includes resizable:
  `src/platform/darwin/window-create.ts:49-51` — `// titled(1) | closable(2) | miniaturizable(4) | resizable(8);` /
  `const style = 15n | (material ? 32768n : 0n);`. The missing step is the collection-behaviour bit,
  which is darwin-only and has no Windows or Linux analogue to copy.

## Notes for lane A (read, not run)

- `-isFullScreen` does not resolve on macOS 27, so a verification read must use style mask bit 14:
  `src/platform/darwin/shim/92_window_state.c:44-47` — "`-isFullScreen` does not resolve on macOS 27
  (measured 2026-11-15), so the state is styleMask's bit 14, NSWindowStyleMaskFullScreen."
- The site documents the current 257 as an activation fix, so it will read stale after the change:
  `site/app/docs/reference/config/page.mdx:32` — "on every Space (`setCollectionBehavior: 257`)".
  That is a doc edit, not a second writer.
- Whether `-toggleFullScreen:` actually enters fullscreen on a window still carrying
  `FullScreenAuxiliary` is not tested here — it would need a launch, which this lane did not do.
