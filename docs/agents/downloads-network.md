# downloads + network lane memory

## What exists

- **`src/platform/darwin/shim/downloads/{00_prelude,10_block,20_delegate,30_api}.c` is ONE translation unit**, joined in `downloads-ffi.ts` — the parts share statics (`dl_downloads`, `dl_text`, `dl_delegate`), so compiling them separately gives each its own copy and the delegate reports into a table nobody reads.
- **`src/platform/darwin/shim/110_network.c` is a single part**, compiled by `network-ffi.ts`; `109_downloads.c` was deleted when the C moved into the folder.
- **The plugin split is types / scope / wiring**: `downloads-types.ts` (shapes + command map), `downloads-scope.ts` (`requireText`, `inside`, `destination`), `downloads.ts` (commands); `network-types.ts` (shapes + `NETWORK_SCHEME` + `NETWORK_LOG_LIMIT` + `NETWORK_URL_LIMIT` + command map), `network-match.ts` (`patternMatches`, `foldsCase`), `network.ts` (commands, re-exporting the matcher so the old import path still works); `fs-scope-path.ts` (`canonical`, `contains`, `readPath`, `outsideScope`), `fs-scope-store.ts` (`SCOPE_FILE`, `readStore`, `writeStore`), `fs-scope.ts` (types + `createFsScope` + `scopeCommands`).
- **`downloads-fake.ts` is the shared test fake** (adapter + `recorder()` ctx), the way `window-fake.ts` and `tray-fake.ts` already work; both test files import it.
- **`darwinDownloadsAdapter({ webview })` and `darwinNetworkAdapter({ configuration })` are structural** — they never import a plugin at runtime, only its types.

## Measured on this machine (2026-11-16)

- **`dl_install(JSCallback ptr)` answered `1`**: the `CrustDownloadDelegate` class allocated, registered, and three methods added, with no `NSApplication` and no window.
- **`net_install(fresh WKWebViewConfiguration, "crust-net", decide)` answered `1`, `net_installed()` `1`**: `setURLSchemeHandler:forURLScheme:` accepts the runtime `CrustSchemeHandler` on a configuration no webview has used.
- **Both units compile with `-framework AppKit -framework Foundation -framework WebKit`** through `cc()`, and `dl_abi()` / `net_abi()` answer `1` (NSObject + WKDownload / WKWebViewConfiguration reachable).
- **Nothing in either unit has been run against a live download or a real page yet** — the delegate class, the handler registration and the JS seam are proven; the two blocks are proven only by construction.
- **`bun run test` is a package script with hardcoded paths**, so `bun run test <files>` runs the whole suite and ignores the filenames; use `bun test <files>` to scope one suite.

## Traps hit

- **A static buffer named `dl_answer[DL_PATH]` collided with the exported `void dl_answer(...)`** — `cc()` refused with `error: incompatible types for redefinition of 'dl_answer'`; the buffer is `dl_destination`, the function keeps the binding name.
- **`-setDelegate:` on `WKDownload` is unretained**, so the delegate instance lives in static storage and is never released; dropping it leaves every download pointing at a deallocated object.
- **A block cannot be created in TinyCC** (no `-fblocks`), so both WebKit blocks are hand-built global blocks: `isa = &_NSConcreteGlobalBlock`, `flags = 0x10000000`, `invoke` = C, descriptor `{0, sizeof(block), 0, 0}` — copying a global block returns itself, so WebKit may keep it.
- **`-startDownloadUsingRequest:completionHandler:` gives no id back**, so the token is queued _before_ the send and the completion pops the oldest (FIFO) — concurrent starts are matched by order, not by URL.
- **WebKit reports a cancelled download as an error**, so the plugin ignores every native event for an entry that is not `"downloading"`; otherwise a cancel flips to `failed` or `finished`.
- **`setURLSchemeHandler:forURLScheme:` on a used configuration raises**, and an uncaught Objective-C exception is a SIGABRT with no JavaScript error — the adapter therefore refuses when no configuration resolver was passed instead of guessing.
- **A `WKURLSchemeHandler` has no pass-through**: "allow" means the handler fetches and delivers the body itself, and with no block available that fetch is synchronous `+[NSData dataWithContentsOfURL:]` on the main thread. It is documented in the C, not hidden.
- **`noUncheckedIndexedAccess` makes `plugin.commands.x` possibly `undefined`** when the plugin returns a bare `PluginDefinition`; each plugin declares a command map type (`DownloadsCommands`, `NetworkCommands`) and builds `const commands: T = {…}` so the test can index it without a cast.
- **A result union with `NotImplemented` blocks property access in tests** — each suite has `function ok<T>(value: T | NotImplemented): T` that throws with the not-implemented message, so a regression names itself.
- **`patternMatches("*://ads/*", "https://ads.example/x")` is false** — the literal middle is `://ads/`, and the URL has `ads.example/`; a glob is anchored on its literal ends, so the test pattern must spell the real prefix.
- **`existsSync` alone was a real overwrite race in `uniquePath`** — the delegate is asked before either file is written, so two downloads started together were both told the same name; a process-local `reserved` set is what makes the answer unique, and it is never pruned because the file lands on disk anyway.
- **`downloads.ts` was extended by the wiring lane, not by me** — it now takes `{ webview: WebviewFor }` (a per-window-label resolver from `webview-target.ts`), returns `LabeledAdapter<DownloadsAdapter>`, and accepts an injectable `unit`; `start(url, id, label?)` forwards the label. Rebase edits onto that shape instead of restoring the older signature.

## Decisions

- **The destination is chosen in JavaScript, not in C**: the delegate copies the suggested filename into `dl_text`, asks JS, and JS writes the absolute path back through `dl_answer` before the delegate returns. That is what makes a unique name (`stem (n).ext`) and a data-root check possible without a struct or an object crossing.
- **Every destination must be inside the app's data root** (`defaultStateRoot`, reused from `window-persist-store.ts`), resolved first so a `..` walk is refused rather than normalised away; a sibling that merely starts the root name is outside it.
- **The plugin owns ids, entries and events; the adapter owns WebKit.** `download:started` is emitted when `start` lands, `download:progress` only when `list()` observes a changed fraction, `download:finished` / `download:failed` come from the native sink.
- **Network rule matching is first-match-wins, no-match-allows, one metacharacter (`*`)** — no regular expression, so a page cannot hand the main thread a catastrophic backtrack.
- **The network log keeps the last `NETWORK_LOG_LIMIT` (100) entries**, and each intercepted request is emitted as `network:request` with `{ url, action, status }` where `status` is `"served"` (the handler fetched it) or `"blocked"` (a real `NSURLError`).
- **`log()` / `network:request` need a handler to have run first**, because the `PluginContext` is captured per command call; `rules()` and `setRules()` both register the scheme handler lazily, so a page that only calls `setRules` is still covered.
- **A refused registration is reported, not thrown**: `rules()` / `setRules()` carry `registered: false` plus the reason, because the rules and the log still work without interception.
- **`scopeAllow` is refused unless the host opted in**: `fs.scopeAllow` appended a prefix and persisted it, so the boundary was writable by the thing it bounds; `createFsPlugin({ grants: "page" })` is the only way to reach it, and the refusal is `outside-scope` naming `grants is "runtime"` (2026-11-16).
- **`fs.scope` absent still means no restriction, and now says so**: `fs.scopeList` answers `{ paths, scoped: false, reason }`, so an app author sees the missing boundary instead of assuming one; the default was kept because changing it breaks every existing app (2026-11-16).
- **The scope store is refused by path, before the scope test and before the unscoped shortcut**: `scope.json` sits in the data root a page may write, so a page could plant a grant the next launch honours — measured with `writeTextFile` resolving before the fix, and `fs-scope-tamper.test.ts` now proves it refused (2026-11-16).
- **An HMAC over the grant list cannot replace that**: an unscoped app page reads every file the user can read, a per-process key breaks restart persistence, and a Keychain key lives in `src/platform/**`; the deny is the only honest one available here (2026-11-16).
- **`samePath` folds case on darwin/win32**: `canonical` keeps a page-chosen leaf casing when the file does not exist yet, so `SCOPE.json` would name the same APFS file and dodge a byte-wise compare; `fs-scope-path.ts` duplicates the three-line fold rather than importing `network-match.ts` (2026-11-16).
- **The network matcher moved to `network-match.ts`** (`patternMatches`, `foldsCase`) and `network.ts` re-exports both, so the old import path still works; matching folds case on darwin/win32 and stays byte-wise on linux, because there `/Etc/Hosts` and `/etc/hosts` are two files (2026-11-16).
- **A URL at the native buffer bound is blocked, never matched**: `NET_TEXT` is 2048 and `net_copy` truncates at 2047 bytes, so `decide` answers `block` with `reason: "url-too-long"` for anything at or beyond `NETWORK_URL_LIMIT` — matching a truncated prefix let a tail-anchored rule be dodged with a long query string (2026-11-16).
- **Pattern cost is bounded at `setRules`, not at match time**: a pattern over `NETWORK_PATTERN_LIMIT` (2048) or with more than `NETWORK_WILDCARD_LIMIT` (32) stars is `bad-request`, so the main thread never matches an unbounded glob (2026-11-16).
- **The reservation is the fix, not the disk check**: `uniquePath` reserves every path it hands out, because the delegate is asked before any file exists; the `Date.now()` fallback is reserved too, and the visible form stays `name`, `name (1).ext`, `name (2).ext`.
- **`WindowRegistry` now answers `webview(label)` and `webviewResolver` (`webview-target.ts`) builds the `WebviewFor` the downloads adapter takes** — that gap was closed by the wiring lane, so only the window-construction change is left.
- **The destination is proven by `src/platform/darwin/downloads.test.ts`**: `uniquePath` is exported for it, and the suite uses a real `mkdtempSync` directory so disk-aware skipping and reservation-aware skipping are both exercised.

## What the next lane must do

- **`src/platform/darwin/window-create.ts` must build `[[WKWebView alloc] initWithFrame:configuration:]`** with a configuration that already has `setURLSchemeHandler:forURLScheme:` applied; today it uses `[[WKWebView alloc] init]`, so no page request can reach `crust-net`.
- **`src/runtime-plugins.ts` does not mount `createDownloadsPlugin` / `createNetworkPlugin`, and `src/plugins/index.ts` exports neither** — both barrels were off-limits to this lane.
- **Gate for this area**: `bun check` && `bun run test` && `bun run check:lines`, plus `bun test src/plugins/downloads.test.ts src/plugins/network.test.ts src/plugins/network-pattern.test.ts` for the scoped proof.
- **A probe that compiles C is safe; one that opens a window is not** — `bun -e 'await import("…/downloads-ffi.ts")'` compiles and calls `dl_abi()` without AppKit starting, and that is how both units were proven.
