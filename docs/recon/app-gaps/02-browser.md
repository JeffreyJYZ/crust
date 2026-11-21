# Gap 2 — browser: "no webview inside a webview"

## 1. Verdict

**`crust feature`** — but the app's phrasing is only half true, and the half that is false changes the cost.

- A second **webview** is already possible: `window.create({ label, url })` opens a window whose webview
  loads any absolute URL, and a genuinely foreign URL is handed through untouched with no bridge token
  (`src/plugins/window-create.ts:53-75`, `src/platform/darwin/window-create.ts:175-184`). macOS has
  also measured that two webviews off one configuration both build
  (`src/platform/darwin/webview-configuration.ts:10-11`).
- What is genuinely missing is a **second webview inside the app's own window** — a surface beside or
  over the app's page. Nothing in the platform seam can express that: `Platform` is window lifecycle
  only (`src/app-types.ts:27-51`), and the window registry maps *one label to one window and one
  webview* (`src/platform/darwin/windows.ts:94-102`).

So: worth building, as a **plugin with a per-OS native half**, darwin-first, honest `not-implemented`
elsewhere — exactly the shape `navigation` already has (`src/runtime-plugins.ts:179`,
`src/runtime-non-darwin.ts:55`, `src/plugins/navigation.ts:69-74`). It does **not** belong in
`Platform`: `Platform` has one implementation per OS and no optional members beyond
`windowLabels`/`lifecycle` (`src/app-types.ts:27-51`), so a member there obliges all three OSes at
once. `window`, `tray` and `shell` all take a native adapter and degrade (`src/plugins/window.ts:41-72`,
`src/plugins/tray.ts:29-48`, `src/runtime-plugins.ts:160-191`); a browser surface follows that, not
`Platform`.

## 2. Evidence

**The seam.**

- `Platform` members: `start`, `pump`, `createWindow`, `window`, `destroy`, `quit`, optional
  `windowLabels`, `lifecycle` — `src/app-types.ts:27-51`.
- The single `addSubview:` of the app's webview — `src/platform/darwin/window-create.ts:94`, after
  `WKWebView` construction at `:76-80` and four edge constraints at `:110-120`. The only other view
  ever attached to the content view is the material's effect view, and it uses the *positioned* form
  `addSubview:positioned:relativeTo:` with `NSWindowBelow` (`-1`) —
  `src/platform/darwin/shim/115_window_material.c:32-35`. That same call with `NSWindowAbove` (`1`)
  is the primitive an overlay surface needs, so no new `NSView` class work is required on darwin —
  only a frame setter, which C must own.
- Windows 1:1 window→controller: `shim_webview_new(hwnd, …)` is called once per window
  (`src/platform/windows/window-open.ts:102`) and keeps a hwnd table holding one controller per
  window (`src/platform/windows/shim/42_webview.c:9-17`, `62-79`).
- Linux one child per window: `gtk_container_add(win, child)` — `src/platform/linux/shim/40_window.c:95-101`,
  and a `GtkWindow` holds exactly one child.

**How plugins reach the platform** — `src/runtime-plugins.ts:147-195` builds the darwin list, with
`createNavigationPlugin(navigation.darwinNavigationAdapter(webviewFor))` at `:179` and
`webviewFor = darwinWebviews(platform)` at `:134`. Non-darwin registers bare refusals
(`src/runtime-non-darwin.ts:44-62`), and `navigation` is literally in that list at `:55`.

**What a second surface can already reuse (this is the good news).**

- Load state, history and failure events are **per webview**, not per window:
  `crust_nav_install(view)` / `crust_nav_uninstall(view)` with a `listeners` map keyed by the webview
  pointer — `src/platform/darwin/navigation.ts:112-136`, `:49-50`, unit at
  `src/platform/darwin/navigation-unit.ts:58-60`, `107_navigation.c:160-190`.
- The resolver already takes a label and refuses an unknown one rather than falling back
  (`src/platform/darwin/webview-target.ts:39-52`), so the routing seam exists; what it reads is
  `windowLabels()` + `webview(label)` (`WebviewWindows`, `src/platform/darwin/webview-target.ts:15-20`).
- A view host needs no new class: `shim_new(cls)` exists and is bound
  (`src/platform/darwin/index.ts:77`, `shim/20_sends.c:61`), and `NSView addSubview:` is already
  preflighted (`src/platform/darwin/preflight.ts:81`).
- A **clean** configuration is free: `shim_webview_configuration()` alloc-inits a new one on every
  call (`src/platform/darwin/shim/30_webview.c:15-20`), so a surface that must carry no bridge
  user scripts can simply not use the shared one (`src/platform/darwin/webview-configuration.ts:22-28`).

**Security and identity.**

- Grants are per **window label**, bound to the token when the document was served, never to the
  `window` field a page sends — `src/bridge/server/capabilities.ts:12-14`, `88-101`; token minting is
  `mintPageToken(label)` (`src/bridge/server.ts:88`) over a `labels` map seeded with the process token
  at `:51-57`. A surface with its own label therefore inherits the grant model unchanged, and a label
  with no `grants` entry holds nothing (`capabilities.ts:98-100`).
- What does **not** extend: `webview(label)` is keyed by *window* label and pruned by window liveness
  (`src/platform/darwin/windows.ts:94-102`, `#isOpen` at `:118-143`). Registering a surface in that map
  makes `window.list`/`close`/`focus`/`isOpen` treat a surface as a window and act on the same
  `NSWindow` twice. A surface needs its own registry (or a `surface:` label namespace the resolver
  consults), not an entry in the window map.
- The bridge user scripts are attached to the **shared** configuration's controller, so WebKit hands
  them to every webview built from it (`src/platform/darwin/content-world.ts:48-53`). A foreign page in
  such a webview gets `window.crustInvoke` with no token (the isolated half reads `?token=` from its
  own document — `content-world.ts:63-67`), so it cannot invoke anything, but it is still a bridge
  transport on an untrusted origin. The honest design gives a browser surface its own configuration.
- **Per-webview safety obligation:** `installWindowMediaCapture(web, microphone)` must run on every
  webview, because an unimplemented UI delegate behaves as *prompt* and a TCC request with no purpose
  string terminates the process (`src/platform/darwin/window-create.ts:88-90`,
  `src/platform/darwin/media-capture.ts:1-18`, `55-63`). A browser surface that omits it hands any
  page a process-kill button.

## 3. What it would take

**The API a page calls** (a `browser` namespace, `src/plugins/browser.ts` + `browser-types.ts`):

```
browser.open({ label, url, x, y, width, height })   → { ok, label }
browser.navigate({ label, url })                    → { ok, loaded }
browser.state({ label })                            → { url, title, loading, canGoBack, canGoForward }
browser.setBounds({ label, x, y, width, height })   → { ok }
browser.close({ label })                            → { ok, closed }
```

That is deliberately a **positioned overlay**, not a DOM element: a native webview cannot be hosted by
the page's DOM, so the app supplies a rectangle in window points and reserves the space itself. This is
the fact that decides usefulness — a side panel or a modal preview is easy; anything that must scroll
inside a page's list is not possible without a real layout engine crust does not have.

**darwin** — the cheapest arm, and the only one I would build first.

- `src/platform/darwin/browser-surface.ts` (new, ~120 lines): build `NSView` host via `shim_new`,
  `addSubview:` it to `-contentView`, build a `WKWebView` from a **fresh**
  `shim_webview_configuration()`, `addSubview:` that, install `shim_media_capture_install(web, 0)`,
  `crust_nav_install(web)`, then `shim_webview_load(web, url)`.
- New C: one export `shim_view_set_frame(view, x, y, w, h)` — a `CGRect` cannot cross `bun:ffi`, which
  is exactly why the frame reads live in C today (`shim/30_webview.c:127-142`). Plus
  `shim_view_remove(view)` (or `S.v1(view, "removeFromSuperview")` with a preflight entry).
- New preflight entries (`src/platform/darwin/preflight.ts:36-85`): `-removeFromSuperview`,
  `-setHidden:`; class `+[WKWebsiteDataStore nonPersistentDataStore]` and instance
  `-[WKWebViewConfiguration setWebsiteDataStore:]` **only if** the slice promises a non-persistent,
  isolated store — otherwise cookies are the app's default store and must be said out loud.
- New `src/platform/darwin/browser-adapter.ts` (~90 lines) shaping the plugin's adapter, reusing
  `darwinNavigationAdapter`'s per-webview install for `state`.
- New registry: `src/platform/darwin/surface-store.ts` (or a `surfaces` map beside
  `WindowRegistry`), because the window map must stay one-window-per-label
  (`src/platform/darwin/windows.ts:26-43`).

**Windows** — the arm that is genuinely expensive, for a structural reason.

- The shim is a **singleton**, not a table: one environment, one controller request
  (`src/platform/windows/shim/32_env.c:39-49` `g_ctrl_hwnd`/`g_ctrl_handler`), one `g_web`
  (`42_webview.c:12`), and `shim_webview_navigate(const char *url)` takes **no handle** (`:111-116`).
  A second surface needs those statics turned into a per-surface array plus a navigate-by-handle, and
  every probe that reads the singleton (`shim_controller_handle`, `shim_webview_handle`,
  `shim_attach_hresult`) has to grow an index — touching `attach.test.ts`, `handler.test.ts`,
  `slots.test.ts`, `abi-width.test.ts`.
- A child window also needs a new creation path: `shim_window_new` hard-codes
  `SHIM_WS_OVERLAPPEDWINDOW` and a top-level parent of `0` (`40_window.c:5-19`), so `WS_CHILD` +
  parent hwnd + `SHIM_MAX_WINDOWS` (`42_webview.c:9`) are all new surface area.

**Linux** — two small but real blockers.

- One child per `GtkWindow` (`40_window.c:95-101`): a surface needs `gtk_box_new`,
  `gtk_box_pack_start`, `gtk_widget_set_vexpand` — three new `PREFLIGHT` entries
  (`src/platform/linux/preflight.ts:33-55`) and a new `shim_window_attach_box`.
- Load state is a single process-wide slot by deliberate design —
  `src/platform/linux/shim/30_webview.c:38-43` says "a second view would overwrite them", read back by
  handle-less `shim_webview_load_state()` at `:165-168`. Per-view state means a small keyed table, which
  is the honest prerequisite before any second view exists on GTK.

**Where it plugs in:** `src/runtime-plugins.ts` (add `createBrowserPlugin(darwinBrowserAdapter(...))` to
the darwin list, near `:179`) and `src/runtime-non-darwin.ts:44-62` (bare refusal), i.e. one import plus
one entry on each arm — the same reconciliation point `runtime-adapters-other.ts` documents at `:5-12`.

## 4. What breaks

- **Security, the real cost.** An embedded browser turns every WebKit/WebView2/WebKitGTK permission
  surface into something an untrusted page can ask the app's *own* code-signed binary for: camera, mic,
  geolocation, notifications, clipboard read, file pickers. crust's posture is deny-by-default and
  typed refusals (`src/plugins/define.ts:40-51`), and its one existing permission decision is
  deny-everything-else (`media-capture.ts:12-18`). Shipping a surface without the same gate inverts it.
  The largest single risk is therefore **a browser surface that silently also becomes a permission
  broker** — a page in a crust app asking for the mic and macOS showing crust's own name.
- **Navigation policy.** `target=_blank`, `window.open`, `file:`/`data:`/custom-scheme URLs and
  downloads all reach the platform once a foreign page loads: there is no `WKUIDelegate`
  `createWebViewWithConfiguration:` handling today (rg over `src/platform/darwin` finds only the
  media-capture delegate), and `downloads` is bound to the app's own webview resolver
  (`src/runtime-plugins.ts:181`). A slice without a navigation policy is an unbounded new-window
  generator.
- **Line cap.** The darwin arm is 2–3 files under 200 lines each (`scripts/line-cap.ts`); the Windows
  arm will not fit — `42_webview.c` is already 174 lines and `32_env.c` 187.
- **Tests/e2e.** Each arm needs a fake-adapter unit test (`browser.test.ts`, plus
  `browser-adapter.test.ts`) and a real e2e (`scripts/e2e-browser.ts` + a `package.json` script) since
  every native surface here is proven by a run, not a mock. `check:parity` needs its row
  (`scripts/check-parity.ts`, page `site/app/docs/reference/parity/page.mdx`), and the docs site needs a
  page under `site/app/docs/reference/api-*` plus a `limits` note that this is an overlay, not a DOM
  element.
- **Shape that makes crust worse.** A surface that shares the app's `WKWebViewConfiguration` inherits
  the bridge scripts (`content-world.ts:48-53`) and the `crust-net` scheme handler
  (`src/platform/darwin/network.ts:9-11`) — cheap to write, wrong to ship. A surface registered in the
  window map breaks `window.*` for the real window. Both are the "looks done, is a defect" cases.

## 5. Estimate

**M for the honest darwin slice; L for three-OS parity.** The darwin arm is one new module pair, ~15
lines of C, two preflight entries and a surface registry — genuinely small. It becomes L because
Windows' controller/environment statics are a singleton by construction (`32_env.c:39-49`,
`42_webview.c:9-17`) and every probe and test that reads them has to grow an index, while Linux needs a
container widget *and* per-view load state that its own comments say does not exist
(`30_webview.c:38-43`).

**Smallest honest slice that is still useful:** `browser.open` + `navigate` + `state` + `setBounds` +
`close`, darwin only, own configuration (no user scripts, no scheme handler), media-capture denial
installed, `http`/`https` only, `target=_blank` refused with a typed failure and the URL handed to
`opener` instead. That is a read-only viewer with a rectangle — enough for a docs pane, a link preview,
an embedded sign-in page or a PDF-ish third-party view, and nothing else.

## 6. What stays the app's job

- **Chrome and layout:** toolbar, back/forward buttons, address field, drag handles, and where the
  rectangle goes when the window resizes. crust exposes bounds; the app owns the geometry and must
  re-`setBounds` on resize.
- **Deciding what may be shown:** the allowlist of origins, whether cookies persist, whether a login
  page is trusted with credentials typed into it. crust should ship a policy hook, not a policy.
- **Anything that reads the page:** an embedded surface must never get a JS bridge. Extraction,
  scraping or "read the price and fill my form" is the app's integration problem and, at that point,
  the app should be calling an API rather than embedding a browser.
- **What a click means:** deep-linking out to the system browser, opening in a real crust window, or
  ignoring it — the app decides; crust only refuses by default.
