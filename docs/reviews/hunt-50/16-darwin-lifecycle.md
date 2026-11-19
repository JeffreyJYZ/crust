# hunt-50 · darwin window lifecycle and teardown (16)

Scope: `src/platform/darwin/window-create.ts`, `windows.ts`, `window-adapter.ts`, `window-chrome.ts`, `window-chrome-adapter.ts`. Read-only review.

**Count: 4 findings** (1 high, 2 medium, 1 low). Worst is finding 1.

---

## 1 (worst) — `createNativeWindow` leaks the whole native window when any step after allocation throws

- `src/platform/darwin/window-create.ts:62` — `shim_window_new` returns a +1 `NSWindow` (alloc/init in `shim/40_window.c:12-21`).
- `src/platform/darwin/window-create.ts:79` — `shim_webview_new` returns a +1 `WKWebView` (`shim/30_webview.c:24-33`).
- Throw sites after both are live: `:83` (web null), `:93` (content null), `:118` (a constraint null), `:128` (material unavailable), `:138` (title readback mismatch), `:184` (`shim_webview_load` failed).
- `src/platform/darwin/platform.ts:108-110` — `createWindow` calls `createNativeWindow` and only `track()`s on a successful return; there is no `try`/`catch` and no cleanup on throw.

Every throw after line 62 abandons an allocated, never-closed, never-released `NSWindow` + `WKWebView` + up to four active constraints. `setReleasedWhenClosed: 0` (`:73`) was already applied, so even AppKit will not reclaim the window on a later close. Nothing else holds the pointer: the label was never tracked, so `list()` never shows the window and `close(label)` refuses it with `unknown-window` (`window-adapter.ts:16-25`).

The `:184` path is the worst shape: it sits after `makeKeyAndOrderFront:` (`:141`) and `orderFrontRegardless` (`:148`), so the orphan is **visible on screen** with a blank/unloaded page and no API handle. `options.url` is only checked by the scheme regex at `:176`, which accepts malformed absolute URLs (`http://[`, `https://%`) that `NSURL` can reject — a config or invoke with one of those throws here. The title readback at `:138` is another reachable trigger for any title NSString does not round-trip.

A retry leaks again: `platform.createWindow`'s guard is `#windows.has(label)` (`platform.ts:100`), which stayed false, so the same label creates a second window while the first remains.

Reached: startup via `openWindows` (`src/app-loop.ts:138`) with a bad `title` or `url`, or a page calling `crust.window.create` with one. Each failure permanently leaks native objects; a load failure also leaves an untracked window on screen that only the user's red button can close.

---

## 2 — No teardown ever releases a closed window; the objects become unreachable

- `src/platform/darwin/window-create.ts:62,79` — window and webview are +1 from alloc/init.
- `src/platform/darwin/window-create.ts:73` — `setReleasedWhenClosed: 0`, so `-close` deliberately withholds the balancing release.
- `src/platform/darwin/windows.ts:62` and `:98` — `handle()`/`webview()` prune the map entry on a closed window but send no `-release`.
- `src/platform/darwin/platform.ts:169` — `quit()` closes only `this.#windows.labels()`, which `windows.ts:73-80` filters to open windows, so closed-but-tracked labels are skipped at teardown too.
- No `-release` send for the window or webview exists anywhere in the darwin shim (`shim/40_window.c`, `shim/30_webview.c`). Contrast `src/platform/windows/windows-registry.ts:54-56`, which keeps `entries()` of "every tracked window, closed ones included, for `quit()`'s teardown".

Keeping a closed window addressable is intentional (the liveness read needs it), but there is no later release to match. Dropping the map entry removes the only JS reference while the native +1 retain remains, so each closed window and its `WKWebView` are retained forever with nothing able to reach or release them. A long-lived app that opens and closes windows accumulates one full window + webview (and its WebKit page) per cycle.

Reached: create a window, close it, then call `list()` / `isOpen()` / re-create the label — the entry is pruned (or filtered) and the native objects become permanently unreachable; repeat for unbounded growth. `quit()` does not recover them (it walks open windows only), though `process.exit(0)` at `platform.ts:185` finally lets the OS reclaim the process at shutdown.

---

## 3 — `setDecorations` leaves a half-mutated window when the frame restore fails, and a retry then silently reports success

- `src/platform/darwin/window-chrome-adapter.ts:38` — `sends.setStyleMask(win, next)` mutates the mask.
- `src/platform/darwin/window-chrome-adapter.ts:42-43` — one `setFrame(win, before)` restore attempt, then a read-back.
- `src/platform/darwin/window-chrome-adapter.ts:44-49` — throws "was not restored" **without rolling the style mask back**. The window is left with the new mask and the AppKit-moved frame; the error text itself admits "the window is now a different size than before".
- `src/platform/darwin/window-chrome-adapter.ts:26-34` — the pre-guard only refuses an *unreadable* frame; it does not cover a failed restore.

The comment at the top of the file (`:1-3`) presents the read/re-apply/read-back as making the toggle safe, but the read-back only detects the failure — it does not undo it. The follow-on makes it worse: on the next `setDecorations(label, value)` with the same `value`, `next === mask` at `:37` returns early, so the failed restore is never retried and the command reports success while the window keeps the wrong size and mask.

Reached: a page toggles decorations on a window whose frame AppKit controls and refuses `setFrame:` (e.g. a window in fullscreen, or mid live-resize) — `setStyleMask:` moves the frame, the restore does not take, the command throws, and every later toggle of the same value is a silent no-op in the wrong state.

---

## 4 — Relative-URL `create` resolves against open windows only, so it fails once the last http window closes

- `src/platform/darwin/window-adapter.ts:30-44` — `documentBase()` iterates `platform.windowLabels()` and its own doc says "the first **tracked** window whose URL is a real web URL".
- `src/platform/darwin/windows.ts:73-80` — `labels()` returns only windows passing `#isOpen`, i.e. open ones; closed-but-tracked windows with a valid URL are never candidates.
- `src/platform/darwin/window-adapter.ts:47-50,87` — `resolveDocument` calls `documentBase()`, so `create()` with a relative `url` throws when none remain.
- Side effect on validation: `create()` calls `platform.window(options.label)` at `:80` first, and that prunes a closed entry (`windows.ts:61-63`) before resolution at `:87`, so a failed create has already mutated the registry.

The implementation is narrower than its documented contract: a closed window that still has an absolute `http(s)` URL cannot serve as the base even though it is still tracked and still addressable for `isOpen`/state save (`window-closed-label.test.ts:32-71`).

Reached: an app that keeps running after its last window closes (the `window-all-closed` watcher is installed only when a listener exists — `src/app.ts:163`) and a page calls `crust.window.create({ label: "main", url: "/next" })` with a relative URL; `documentBase()` finds no open http(s) window and throws "no open window has loaded one to resolve against". Also reachable with several windows where the only http(s) one is closed and the rest are `about:blank`.

---

## Worst

Finding 1. It is an unconditional native-resource leak on every failed create with no recovery path: the window, webview and constraints are allocated before `platform.createWindow` gets a chance to track them, so no `close`, `destroy`, `quit` or registry prune can ever reach them. On the `shim_webview_load` failure (`:184`) the orphan is already ordered front, leaving a visible blank window that no API can close by label, while a retry passes the `has()` guard and leaks a second one. The other findings are leaks or stale state in already-created windows; this one produces an unreachable, possibly on-screen window from a single bad `title` or `url`.
