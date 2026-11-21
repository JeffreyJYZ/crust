# window webview lane memory

## What changed

- **`createNativeWindow` builds the webview from the platform's one `WKWebViewConfiguration`** — `shim_webview_new(configuration, 0, 0)` sends `-initWithFrame:configuration:`, so `setURLSchemeHandler:forURLScheme:` is finally reachable in a real app. `webview-configuration.ts` owns that object (`webviewConfiguration()`), the barrel re-exports it, and `darwinNetworkAdapter({ configuration })` is the only thing that names a scheme.
- **The frame stays zero and Auto Layout owns the size**, which is what `[[WKWebView alloc] init]` left behind, so nothing about layout moved.
- **`shim_webview_new` refuses a nil configuration** rather than defaulting one: WebKit's own configuration is exactly the object no handler can reach, so a silent fallback would hide the defect again.

## Measured (2026-11-16)

- **`setURLSchemeHandler:forURLScheme:` on a configuration a webview already uses does NOT raise** — only the SAME scheme twice does (exit 134, SIGABRT). The comments in `network.ts` / `110_network.c` that say a used configuration raises are the duplicate case, not the used one. Late registration is therefore safe; it is just ineffective for the webview that already exists.
- **Late registration is ineffective, measured**: a page loaded after the handler landed on its own configuration still answered `fetch-failed=Load failed`, with `served=0 tasks=0`.
- **A configuration must be registered on BEFORE the webview exists**, and WebKit copies it at creation — so the app's order has to be handler first, window second.
- **Two webviews from one registered configuration both build**, and one configuration for the process is what makes "register once, every later window carries it" true.
- **Through the real `createNativeWindow` path**: `registered=true`, then `tasks=1 bytes=16 log=["crust-net://app/data:served:16"]` — LIVE, so the window path serves scheme bytes.
- **`bun fmt` with explicit paths left all five files unchanged**, `bun test src/platform/darwin` 114 pass, `bun run e2e:window` 61/61 PASS in 2.9 s.

## Activation (measured 2026-11-16)

- **The first window activates the app** — a built `.app` run directly (`X.app/Contents/MacOS/<bin>`) went `front=Ghostty` before, `front=Activation crust` at t1.5, read with `lsappinfo info -only name $(lsappinfo front)`.
- **A window created while another app is frontmost STEALS focus** — the page created window `b` at ~7.5 s with Ghostty front and `front` flipped to the app at t8. Control run (same page, same timings, `?nocreate=1`) kept Ghostty from t3 to t13, so the create is the cause.
- **The `!isActive` guard in `window-create.ts` is the wrong test**: `isActive` is false for every window created while the human is in another app, so the send happens exactly then, and `platform.activateOnce()` cannot cover it — that is a separate send, so it is not once-per-process.
- **Narrowing it means once-per-process (first window only)**, and the cost is the accessibility fix for later windows: a window created while the app is inactive is off the active Space and out of `AXWindows` until the user clicks the app.
- **`bun run` never activates** — an unbundled process stays `active=false` and never becomes frontmost, so this can only be measured on a built bundle run directly. Any probe that launches one must hand focus back (`restoreFocus` in `scripts/e2e-harness.ts`, or `open -a Ghostty`).

## What the runtime still owes

- **RESOLVED — the network adapter is wired with the configuration.** No `darwinNetworkAdapter()` call remains in `src/runtime-plugins.ts`; wiring lives in `src/runtime-network.ts:22`, which passes the shared `webviewConfiguration()`. `install` no longer refuses for lack of a configuration. The second half of this old note (lazy `ready()` in `createNetworkPlugin`) is a separate item, not part of this file's wiring claim.
- **Even with that line, the window open when the page calls `network.setRules` is not covered**, because `createNetworkPlugin` registers lazily on the first `rules`/`setRules` call — which is after the first webview exists. Covering it needs `ready()` called eagerly in `createNetworkPlugin` (`src/plugins/network.ts`), which is outside this lane.
