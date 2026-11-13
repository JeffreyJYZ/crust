# Electrobun recon for crust

Source: `git clone --depth 1 https://github.com/blackboardsh/electrobun` → `research/electrobun/repo`
HEAD `1a8652d26515f332b076f98ac39385e8d4454032` (2026-11-12), tag `v2.0.7-beta.15`.
The first clone attempt died on the local intercepting proxy; the retry succeeded, so everything below is read from the working tree plus its bundled `docs/src/content/docs/electrobun/**`.

Every file:line citation below was opened, not inferred.

> **Brief correction up front.** The brief asks how "a Bun-based desktop app" is structured. Electrobun 2.x is not Bun-shaped at the bottom. Bun is only the *default* main-process runtime, chosen at build time from six (`bun`, `cottontail`, `zig`, `rust`, `go`, `odin` — `package/src/launcher/main_process.zig:3`). Below the JS runtime sits a **native layer that owns the main thread**, and the JS runtime is moved off it. That single inversion is the most important thing in this report and it is the opposite of crust's §3 design.

---

## 1. Main process ↔ webview: transport, encoding, latency

### Transport

Not HTTP. Not a Unix socket. **A loopback WebSocket server implemented inside their Zig core.**

- Server: `package/src/core/main.zig:1857` `listenHostTransport`, `:1872` `hostTransportAcceptLoop`, `:1891` `startHostTransportServer`.
- Bind address is hard-coded `[IP_ADDRESS]` (`main.zig:1913`), port picked by scanning `50000..65535` (`main.zig:122-123`).
- Handshake is hand-written HTTP/1.1 `101 Switching Protocols` (`main.zig:1417-1433`), then a hand-rolled frame reader/writer (`main.zig:1435-1600`). No library.
- Frame payload cap: **500 MiB** (`main.zig:121`, `websocket_payload_limit = 1024*1024*500`).
- Page side: `new WebSocket("ws://[IP_ADDRESS]:${HOST_SOCKET_PORT}/socket?webviewId=${WEBVIEW_ID}")` — `package/src/browser/index.ts:85-87`.
- The `webviewId` query param is the *only* thing identifying the caller (`main.zig:1817-1825`); unknown ids get `404`.

### Encoding

**JSON text frames, encrypted with a per-webview AES-GCM key.**

- Key: 32 random bytes per view, `new Uint8Array(randomBytes(32))` — `package/src/sdks/main/core/BrowserView.ts:168`.
- Key is handed to native as a decimal comma list (`secretKey: this.secretKey.toString()`, `BrowserView.ts:199`), parsed back at `main.zig:1229`.
- Native injects it into the page as a preload literal: `window.__electrobunSecretKeyBytes = [...]` (`main.zig:1991`).
- Page encrypts before send: `__electrobun_encrypt` → `{encryptedData, iv, tag}` JSON envelope (`package/src/browser/index.ts:228-237`), AES-GCM via WebCrypto (`package/src/preload/encryption.ts:40-70`).
- Native decrypts inbound (`main.zig:1786`), encrypts outbound (`main.zig:4005`).
- Their stated reason for skipping TLS: *"Using ws:// for loopback is intentional - all RPC messages are encrypted with per-webview AES-GCM keys, making TLS redundant"* (`package/src/browser/index.ts:83-84`).
- A plaintext mode exists (`__electrobunPlaintextHostSocket`, `browser/index.ts:224`; `setWebviewPlaintextHostTransport`, `main.zig:3972`) but **no caller turns it on** in this tree — dead escape hatch.

### RPC packet shape

`package/src/shared/rpc.ts:1-20`:

```ts
{ type: "request", id, method, params }
{ type: "response", id, success: true, payload } | { type: "response", id, success: false, error }
{ type: "message", id, payload }
```

Schema is declared once, both sides typed from it (`ElectrobunRPCSchema { bun, webview }`, `rpc.ts:518`). Call surface is a `Proxy` (`rpc.ts:342` request, `:375` send), so `rpc.request.greet({name})` needs no per-method declaration. Default request timeout **1000 ms** (`rpc.ts:188`, `DEFAULT_MAX_REQUEST_TIME`), overridable per call; `Infinity` disables (`rpc.ts:47-51`).

### Fallback path

If the socket is unavailable the packet goes through the native bridge instead: `sendMessageToHostViaFallback` → `window.__electrobunHostBridge?.postMessage(...)` (`browser/index.ts:245-253`), and inbound via `window.__electrobun.receiveMessageFromHost(...)` wrapped into a JS call (`BrowserView.ts:233-253`) that is evaluated with no completion handler (`BrowserView.ts:269-274`). Windows is explicitly **socket-less**: `sendHostMessageToWebviewViaTransport` returns `false` immediately on Windows (`main.zig:3987-3989`), and `HOST_MESSAGE_SOCKET_AVAILABLE = process.platform !== "win32"` (`BrowserView.ts:33`).

### Latency story

There is **no published latency number anywhere** — no benchmark, no p50/p99, no `hyperfine` script, no CI perf job. `rg` for `latency|round-trip|throughput|benchmark` over `docs/src/content` and `package/src` returns only test names. What they publish instead is *throughput engineering*, which is where the real information is:

- Outbound host→view messages are serialised once at enqueue, not at flush (`BrowserView.ts:403-415`).
- Batched: max **256 messages** or **512 KiB** per turn (`BrowserView.ts:30-31`, `431-448`).
- Each flush turn yields to the event loop after **8 ms** (`HOST_MESSAGE_SEND_TURN_MS`, `BrowserView.ts:32`, `500-505`) with the comment *"Limit each turn so input remains responsive"*.
- Two queues so RPC **responses** can jump ahead of fire-and-forget messages (`hostResponseSendQueue`, `BrowserView.ts:399-402`, prioritised only on Linux).
- Queue depth is inspectable at runtime (`getHostMessageQueueStats()`, `BrowserView.ts:519-533`), and the docs are careful that byte counts are *not* retained heap and draining is *not* delivery acknowledgement (`docs/.../apis/browser-view.mdx:273-276`).

So the honest characterisation: **latency is designed for (bounded batches, yielding, backpressure), never measured and never claimed.**

---

## 2. Native layer: where, what language, why

Three layers of it, all compiled:

| Piece | Language | Size | Role |
| --- | --- | --- | --- |
| `package/src/core/` | **Zig** (0.17.0) | 158 `export fn` | `libElectrobunCore.{dylib,so,dll}` — process/lifecycle core, **owns the WebSocket RPC server**, updater, insights, window/webview *calls into* the platform wrapper |
| `package/src/native/{macos,win,linux}/` | **Objective-C++ / C++** | mac 11,699 lines / 161 `extern "C"`; win 16,509 / 34; linux 14,085 / 6 | `libNativeWrapper.{dylib,dll,so}` — the actual AppKit / WebView2 / GTK calls |
| `package/src/launcher/` | Zig + a thin `main.ts` | 271 lines TS | native bootstrap executable; `launcher` is Zig (`build.ts:2583`) |

Link line for macOS, which shows the whole dependency surface in one string (`package/build.ts:2289`):

```
clang++ ... -framework Cocoa -framework WebKit -framework QuartzCore
  -framework Metal -framework MetalKit -framework UserNotifications
  -F./vendors/cef/Release -weak_framework 'Chromium Embedded Framework'
  -lcef_dll_wrapper -shared -install_name @executable_path/libNativeWrapper.dylib
```

### Why they needed it — the load-bearing answer

**Because a native GUI framework demands the process main thread, and they were not willing to give it to the JS runtime.**

From their own architecture doc (`docs/.../guides/architecture/overview.mdx:70-77`):

> "Native GUI frameworks require their event loop on the process main thread, and Electrobun respects that instead of fighting it. Cottontail and Bun run your application JavaScript on a worker while Electrobun Core owns the main-thread event loop."

The mechanism is visible in the launcher (`package/src/launcher/main.ts:249-259`):

```ts
new Worker(appEntrypointPath, { ... });          // app JS moved OFF the main thread
const runStatus = lib.symbols.electrobun_core_run_main_thread(   // and never returns
  ptr(...identifier...), ptr(...name...), ptr(...channel...), 0,
);
```

`electrobun_core_run_main_thread` (`main.zig:3018`) loads `libNativeWrapper` and calls its `startEventLoop` (`main.zig:2076-2084`). AppKit then runs *natively*, for real, on the real main thread, blocking there forever.

This is the exact inverse of crust's §3 (`setInterval` pumping `CFRunLoopRunInMode` from JavaScript). Electrobun looked at the same problem and chose to move the *JavaScript* instead of pumping the *Cocoa*. Crust cannot make that choice without an artifact.

The second reason, closely related: **`bun:ffi` was not enough on its own.**
- 216 FFI symbol declarations live in `package/src/sdks/main/proc/native.ts` (216 `name: { … }` entries, 25 of them `threadsafe: true`), so they *do* drive a lot from Bun — but only into a **prebuilt dylib that they compiled**, never into raw `objc_msgSend`.
- JSCallbacks from the main thread are explicitly unsafe: `callJsCallbackFromMainSync` exists because *"this lets you call non-threadsafe JSCallbacks on the bun worker thread, from the main thread and wait for the response"* (`nativeWrapper.mm:412-419`), with deadlock-prevention queueing when re-entered (`:417-418`, `:500-505`). They also replaced JSCallbacks outright for webview HTML: *"Webview content storage (replaces JSCallback approach)"* (`nativeWrapper.mm:397`).
- Struct-by-value in the C WGPU API is refused outright: *"WGPUStringView is passed by value in the C API. Bun FFI does not support..."* (`package/src/sdks/main/webGPU.ts:5`).
- Two separate Bun-FFI race workarounds are baked into the preload: a 2 ms delay *"to work around Bun JSCallback threading issue"* (`package/src/preload/internalRpc.ts:28`) and a `setTimeout` for *"a race condition with Bun FFI"* (`package/src/preload/events.ts:11`).
- Their FFI contract is regression-tested precisely because runtime changes break marshaling: `package/src/sdks/main/__tests__/ffi-contract.test.ts:3` — *"Runtime changes can break JSCallback marshaling, FFIType encoding, or dlopen"*.

**Verdict on the brief's implicit question.** The native layer is not there for capability that Bun lacks; it is there for *thread ownership*. Bun could make most of the calls. It could not be the main thread.

---

## 3. Packaging

### Self-extracting bundle

A Zig executable with the payload appended and located by magic markers:

- `ELECTROBUN_ARCHIVE_V1` and `ELECTROBUN_METADATA_V1` (`package/src/extractor/main.zig:33-34`).
- The extractor reads **itself** (`readFileAlloc(exe_path)`, `main.zig:1333`), scans for the metadata marker bounded by a 4096-byte window (`main.zig:1442-1460`), and treats everything after the archive marker as one zstd stream (`main.zig:1400`).
- Adjacent-file layouts win over the embedded one: Windows `.installer/<stem>.tar.zst` (`main.zig:1299-1327`), Linux `../Resources` (`main.zig:1291-1297`).
- Extract target: `~/Library/Application Support/<identifier>/<channel>/self-extraction/` (`main.zig:1386-1394`), with `self-extraction.partial` staging and `.previous` rollback (`main.zig:5545-5553`).
- macOS also gets a real DMG (`bundling-and-distribution.mdx:179`). The extractor does run on macOS (it has macOS branches for the managed install dirs — `main.zig:5526`, `:5545`), but **who ships inside the DMG is Hutch's call and is not in this repo**, so I cannot verify from source whether the `.app` in the DMG is the extractor or the inner app. Flagging that as unverified rather than asserting the update path.

### Compression

- **Zstandard** for the archive (`std.compress.zstd`, `main.zig:3`), streamed with `zstd.default_window_len + zstd.block_size_max` (`main.zig:1684`).
- **BSDIFF** for deltas: vendored `zig-bsdiff` binaries `bsdiff`/`bspatch` (`build.ts:811-812`), patches named `<previous-hash>.patch`, applied via `stream_patch.zig` (`docs/.../guides/updates.mdx:94-118`).
- **Archive recipes** instead of stored tars on the client: `archive_recipe.zig:1-10` keeps a bounded-memory description (path, mode, size, sha256, link target, tar offset) so the client reconstructs the exact tar from installed files. Receipt capped at 128 MiB (`:14`). This is what makes delta patches possible without shipping a full tarball per release.

### The `bundleCEF` tradeoff

- Off by default (`build-configuration.mdx:427`, `445`, `463`); system webview is the default renderer on all three platforms.
- When on, Hutch downloads the pinned CEF minimal dist from `cef-builds.spotifycdn.com` (`build.ts:1793`), builds `libcef_dll_wrapper.a` with cmake, and compiles a `process_helper` (`CEF.md`, "How CEF Gets Built").
- CEF is versioned once per Electrobun release, not per project (`CEF.md`, "Application Artifact Resolution").
- Linux needs **two** wrapper binaries because there is no reliable weak linking: `libNativeWrapper.so` ~1.46 MB (GTK only) and `libNativeWrapper_cef.so` ~3.47 MB (`BUILD.md`, "Dual Binary Approach"). Those are the only hard size numbers in the repo for the wrapper itself.
- Their own framing of the tradeoff: *"CEF materially increases the application download and installed size. System webviews remain the better default"* (`bundling-cef.mdx:11-13`).
- CEF enables things the system webview cannot: on Windows, `<electrobun-webview>` masks and input passthrough *"require CEF"* (`bundling-cef.mdx`, Platform Guidance → Windows). So CEF is not purely a size/consistency dial; some features are CEF-only.

### What a minimal app weighs

**They do not use `bun build --compile`.** There is no `--compile` anywhere in `package/build.ts`; the JS main process is a plain `Bun.build({ entrypoints: ["src/launcher/main.ts"], target: "bun" })` producing `dist/main.js` (`build.ts:2647-2665`), and the launcher spawns a **separately shipped `bun` binary** against it (`launcher/main.zig:443-455`: `argv = { runtime_path, main_script }`). So an Electrobun Bun app = full Bun executable + `main.js` + Zig core + Obj-C++ wrapper + launcher + extractor + views. That is why the runtime is 60–117 MB and why crust's 20–25 MB is a genuinely different architecture, not a better-tuned version of the same one.

No stated figure for a full app. The only published numbers are **runtime executable sizes**, extracted not compressed (`docs/.../guides/changelog/v2-x.mdx:23-32`):

| Platform | Cottontail | Bun | Reduction |
| --- | ---: | ---: | ---: |
| macOS ARM64 | 57,714,960 B | 63,072,928 B | 8.5% |
| Linux x64 | 59,480,576 B | 101,814,712 B | 41.6% |
| Linux ARM64 | 55,183,872 B | 101,309,000 B | 45.5% |
| Windows x64 | 55,587,328 B | 117,660,760 B | 52.8% |

So a **Bun** Electrobun app is ~63 MB on macOS ARM64 *before* the Zig core, the Obj-C++ wrapper, the launcher, the extractor and the views. crust's stated 20–25 MB floor is a different (and much better) number because crust ships no runtime at all — worth stating plainly in crust's own docs so the comparison is not read as like-for-like.

CEF's own floor: their release check asserts the CEF tarball is > 50 MB (`build.ts:140`).

---

## 4. Dev loop

Two loops, and the docs are unusually clear that they are different things (`docs/.../guides/hot-reloading.mdx:9-15`):

| Edit | Command | What happens |
| --- | --- | --- |
| Bun/Cottontail main process | `hutch electrobun dev --watch` | rebuild + **relaunch the whole app**; main-process state resets |
| Zig/Rust/Go/Odin main process | same | rebuild native exe + relaunch; state resets |
| Webview bundled by Hutch | same | rebuild view bundle + relaunch |
| Webview on Vite | `hutch run dev:hmr` | Vite HMR; **native app not relaunched** |

- `--watch` input set: configured main-process source, native build inputs, view entrypoint dirs, `build.copy`, plus `build.watch` / `build.watchIgnore` (`cli-args.mdx:248-257`). Debounced; a failed build leaves the watcher running.
- Platform wrinkle: *"On macOS and Linux, Hutch stops the running development app before rebuilding. On Windows, it currently asks you to close the app"* (`hot-reloading.mdx:49-51`).
- `dev:hmr` is **a template task, not a builtin** — `templates/react-tailwind-vite/hutch.config.ts:6` runs `concurrently "hutch run hmr" "hutch run start"` with `vite --port 5173` (`:7`) — confirmed by `hot-reloading.mdx:98` (*"`dev:hmr` is a task supplied by those templates, not a built-in Hutch command"*). The main process detects the dev server and loads it instead of `views://` (`hot-reloading.mdx:100-101`).
- Runtime-level reload modes exist in Bun/Cottontail but are **deliberately not wired to app main processes**: *"Electrobun does not currently pass those modes to an application main process"* (`hot-reloading.mdx:81`).
- Dev builds route `console.log` from webview to the terminal via injected user scripts (`nativeWrapper.mm:3140-3145`), and expose CEF devtools on a local port; packaged builds disable it unless `remote-debugging-port` is set (`bundling-cef.mdx`, Chromium Flags).

**What restarts:** the app process. Not the JS VM in place. No hot-swap of native objects, no preserved window state.

---

## 5. `.app` layout and signing

### Layout

Docs give the platform-neutral model (`architecture/overview.mdx:85-100`):

```text
Contents/
  MacOS/       executables + dynamic libraries (+ optional Frameworks/)
  Resources/
    app/
      bun/     bundled JS main process
      views/   bundled webview assets  → views://
    version.json
```

- Launcher resolves everything relative to `exe_dir`: `Contents/MacOS/<launcher>`, `../Resources/main.js` for Bun (`launcher/main.zig:444`), `../Resources/version.json` (`:113`, `:332`), `../Resources/build.json` (`:332`).
- `views://` maps to `Resources/app/views` (`PATHS.VIEWS_FOLDER`, `package/src/sdks/main/core/Paths.ts:5`; native resolver `readViewsFileWithRoot`, `nativeWrapper.mm:902-916`).
- Two asset schemes: `views://` (read-only packaged, on by default) and `appdata://` (writable per-user, **off** by default). Both confined to their root; `..` traversal including encoded and symlink escapes rejected (`bundled-assets.mdx:209-211`). Permission follows the webview, not the page origin — a `views://` webview that navigates to a remote URL keeps `appdata://` (`bundled-assets.mdx:198-201`).
- `views://` on macOS WKWebView is served by a real `WKURLSchemeHandler` (`MyURLSchemeHandler`, `nativeWrapper.mm:1047`, registered `:3063-3073`) with a path-canonicalising reader (`canonicalContainedPath`, `:916`).
- Optional ASAR path exists (`libasar`, `asar.h`; launcher reads `bun/index.js` out of `app.asar` and writes it to a randomised temp file, `main.ts:181-236`) — but `buildAsar()` is **commented out** (`build.ts:703`), so in this tree flat `Resources/app` is the shipped layout.

### Signing

- Config: `build.mac.codesign`, `notarize`, `createDmg`, `entitlements`, `icons` (`build-configuration.mdx:420-432`). All default off except `createDmg`.
- Dev builds skip Hutch signing even with `codesign: true`; ad-hoc signatures from the compiler may still be present (`code-signing.mdx:7-9`).
- Identity from `ELECTROBUN_DEVELOPER_ID`; notarisation via App Store Connect `.p8` (preferred) or Apple ID + app-specific password + team ID (`code-signing.mdx`).
- Order: sign nested Mach-O and code bundles **before** the outer app, verify with `codesign`, submit app *and* DMG, staple, validate (`code-signing.mdx:51-54`).
- **No `--deep`**, and this is called out as the fix: *"The notarization issues were fixed by using proper entitlements and not using --deep"* (`build.ts:1086-1088`). Ad-hoc signatures are kept, not stripped, because Apple Silicon requires them (`:1086-1087`).
- Entitlements default is **"JIT defaults"** (`build-configuration.mdx:431`) — i.e. the JSC JIT entitlement set is on by default, which crust's DESIGN.md already predicts it needs.
- Windows release signing is **not** in Hutch's pipeline (`code-signing.mdx:11`).
- Their keychain warning is worth stealing: an ad-hoc-signed exe's designated requirement can be its cdhash, so rebuilding a *native* main process changes identity and macOS may deny previously-saved keychain items. *"This can look like a lost login session even though the credentials still exist"* (`code-signing.mdx`, Dev Builds And Keychain Access). Editing TS alone usually leaves the runtime exe unchanged — which is precisely why a **Bun-native** framework has an advantage here they cannot claim.

---

## 6. Process isolation between main and webview

Their claims, then what the code actually enforces.

**Claims** (`what-is-electrobun.mdx:57-61`): *"Each browser view runs isolated from it and communicates through Electrobun's RPC and event bridges... a compromised or buggy view can't reach what it was never given."* Each view is *"a separate native browsing context"* (`architecture/overview.mdx:62-65`) — the `<electrobun-webview>` element is *"like an isolated iframe, but the embedded content is rendered by its own native webview rather than inside the host document"* (`electrobun-webview-tag.mdx:6-9`).

**What is actually enforced:**

1. **Separate OS process per renderer.** Not their code — WKWebView/WebView2/WebKitGTK each run web content in their own process. Electrobun inherits this. So "isolation" is real but it is the OS's, not a design win.
2. **`sandbox: true` removes the RPC channel entirely** (flag declared `BrowserView.ts:69`, default `false` at `:137`, passed to native at `:214`). Two preloads are compiled: a full one (RPC, encryption, drag regions, webview tags) and a sandboxed one that *"NO RPC, NO encryption, NO webview tags"* (`package/src/preload/index-sandboxed.ts:1-22`). The sandboxed preload has no `__electrobunHostBridge`, no secret key, no socket port (`main.zig:1965-1980` vs `:1983-2006`). This is the strongest single idea in the codebase for crust to copy.
3. **One-way event channel** for sandboxed views: `__electrobunEventBridge` — *"a one-way channel for emitting events to native/bun - no RPC capability"* (`preload/events.ts:5`).
4. **Sender-id validation** on events: `parseWebviewEventBridgeMessage` rejects payloads whose `id` does not match the receiving webview, rejects non-JSON, and treats hostile `detail` as inert string data — with tests (`package/src/sdks/main/proc/eventBridge.ts`, tested in `eventBridge.test.ts`).
5. **Per-webview AES-GCM key** means one view cannot forge or read another's traffic (assuming the key never leaves the page).
6. **Navigation rules** enforced in native, `*` wildcard / `^` block / last-match-wins (`bundled-assets`/`electrobun-webview-tag.mdx`, `BrowserView.setNavigationRules`).
7. **Caveats they document honestly:** `appdata://` permission follows the webview not the origin; on macOS the native renderer's navigation rules apply to the main document only, and child iframes *"cannot call the webview's native bridge"* (`electrobun-webview-tag.mdx`, Navigation).

**What is weaker than it looks:** the `webviewId` is a guessable small integer and is the *only* authorisation on the socket (`main.zig:1817-1825`); there is **no `Origin` check** anywhere in the Zig server (searched `main.zig` for `origin` — only `getWindowContentOrigin`, a geometry query). The key is what actually protects it. crust's DESIGN.md §4 (ephemeral port + per-launch bearer token + `Origin` check + CSP) is a *stronger* posture than Electrobun's on the origin axis.

---

## 7. Claims in the brief I could not verify, and one that is wrong

| Claim | Status |
| --- | --- |
| "RPC over what transport" has a documented latency story | **Wrong.** No latency number, benchmark, or budget exists anywhere in the repo or docs. Only throughput *engineering* (batching, yielding, backpressure) is documented. |
| Electrobun is "a Bun-based desktop app" framework | **Misleading.** Bun is the default of six main-process runtimes; the architecture is native-core-owns-main-thread with JS on a worker. |
| "what a minimal app weighs" is stated | **Not stated.** Only per-runtime executable sizes exist (63 MB macOS ARM64 for Bun). No full-app figure. |
| `bundleCEF` is purely a size/consistency tradeoff | **Incomplete.** Some features (Windows `<electrobun-webview>` masks/passthrough) *require* CEF. |
| Self-extracting bundles are the primary install path | **Only on Linux/Windows.** macOS ships a DMG; the self-extractor is the update path there. |
| ASAR is used for packaging | **Not in this tree.** `buildAsar()` is commented out (`build.ts:703`); launcher still supports it. |
| Plaintext transport is available | **Present but dead.** No caller sets it. |

Also unverified, and flagged as such: **CEF's actual contribution to installed size.** The docs say only *"materially increases"*; no MB figure. The 50 MB figure in `build.ts:140` is a *tarball sanity floor*, not a measurement of an installed app.

---

## 8. Decisions crust inherits

Each with a one-line reason.

**Architecture**

1. **Native core owns the main thread; JS runs on a worker** — the only design that makes AppKit's nested run loops (menus, drags, live resize) work without pumping, and it removes crust's entire §3 risk class. Crust cannot adopt it, but crust should stop pretending the `setInterval` pump is equivalent: it is a strictly worse version of the same idea.
2. **`views://`-style asset scheme instead of an HTTP asset server for the frontend** — but crust should keep its HTTP server for IPC and serve *assets* from the binary. Electrobun proves a custom scheme handler is a few dozen lines of `WKURLSchemeHandler`, which directly contradicts crust's DESIGN.md §4 rejection of scheme handlers.
3. **Two asset roots with different defaults: read-only packaged (`views`), writable per-user (`appdata`), the second off** — capability that is not granted cannot be abused by a navigated-away page.
4. **Path confinement as a native-side invariant**, with `..`, encoded traversal and symlink escapes all rejected — this is the check crust will otherwise forget and ship.

**IPC**

5. **A typed schema declared once, both sides derived from it** (`ElectrobunRPCSchema { bun, webview }`) — the single highest-value idea here for crust's `invoke`, and it is cheap.
6. **Three packet kinds only: request / response / message** — request-response for calls, fire-and-forget for events, and no fourth concept. crust's `invoke` + `listen` is the same shape; keep the wire format that small.
7. **Per-request timeout with a default and a per-call override** — 1000 ms default is too tight for crust's fs/dialog plugins, but the *mechanism* (default + override + `Infinity` escape) is right.
8. **Encrypt the loopback channel with a per-view key** — crust's single per-launch token is weaker than a per-view key, because one leaked token from one view opens every view.
9. **A `sandbox` flag that removes the RPC channel, not just restricts it** — two compiled preloads, one with no bridge at all. Copy this shape exactly.
10. **Sender-id validation on every inbound event, with hostile payload treated as inert string** — their `parseWebviewEventBridgeMessage` is a ~40-line function crust should have on day one.

**Throughput**

11. **Serialise once at enqueue, batch by count *and* bytes, yield to the event loop between turns** — 256 msgs / 512 KiB / 8 ms is a good starting point, and it is the difference between "responsive" and "frozen during a burst".
12. **Expose queue-depth diagnostics on the view object** — cheap, and it turns "the UI is janky" into a number.

**Process / distribution**

13. **Per-channel app data (`~/Library/Application Support/<id>/<channel>`)** — canary and stable side by side, no migration logic, no "which one wrote this file".
14. **`version.json` + `build.json` in `Resources`** — a runtime-readable record of what was built, which is what `crust doctor` should read first.
15. **Sign nested binaries before the outer bundle, never `--deep`** — the `--deep` failure is documented and the fix is free.
16. **Keep ad-hoc signatures rather than stripping them**, and take the JIT entitlements default — crust's own DESIGN.md already predicts both.
17. **Extract to a staging dir, then swap, with a `.previous` for rollback** — the updater pattern crust will need at M6.

**Dev loop**

18. **Two named loops with a documented boundary** (`dev --watch` restarts; `dev:hmr` does not) — the docs' table is the clearest thing in the repo and crust should copy the *table*, not just the commands.
19. **Watch inputs are explicit config, not "the project"** — `build.watch` / `build.watchIgnore` beats guessing.
20. **Dev builds forward webview console output to the terminal** — one `WKUserScript` at `AtDocumentStart` (`nativeWrapper.mm:3140-3145`), enormous quality-of-life win for near-zero cost.

**What to copy about their honesty**

21. **The changelog publishes a size table with the exact runtime versions and says "extracted, not compressed"** — crust's measurement plan (§11) should be published the same way, including the comparisons that look bad.

---

## 9. Cannot be copied

Everything here depends on shipping a compiled artifact, which is the one thing crust forbids.

1. **`startEventLoop` / main-thread ownership.** The whole inversion — Zig core + `libNativeWrapper` calling `[NSApp run]`-equivalent natively while Bun sits on a `Worker`. No `bun:ffi` equivalent exists; crust must pump from JS or accept the consequences.
2. **216 FFI symbols into a self-compiled dylib.** Crust can only reach *system* frameworks via `bun:ffi`. Every Electrobun capability that lives in their own C++ (custom `WKURLSchemeHandler` subclasses, `WKWebView` configuration plumbing, window chrome, `NSMenu` construction, drag regions, spell check, frame policy) is a hand-compiled dylib.
3. **Runtime-created Objective-C classes with `JSCallback` IMPs.** They avoid this too — `nativeWrapper.mm:397` literally says *"Webview content storage (replaces JSCallback approach)"*. Their answer to crust's constraint #3 (delegates) was to compile the delegate in C++ instead. Crust has no such escape; its constraint 3 stands unresolved.
4. **Struct arguments/returns (`CGRect`, `NSSize`, `CGAffineTransform`).** The Zig/C++ boundary marshals these freely. Crust's constraint #2 is untouched by anything in this repo — Electrobun is not evidence that FFI structs work, because they never asked FFI to do it.
5. **`libffi` usage.** Their FFI surface is *their own* C ABI, so they never needed variadic `objc_msgSend`. This repo provides zero evidence for or against crust's risk #1 — the single most important open question in DESIGN.md. **Treat Electrobun as silent on it.**
6. **The native `libNativeWrapper` for macOS (11,699 lines Obj-C++).** Window chrome, traffic lights, `NSMenu`, tray, notifications, file dialogs, `WKWebView` lifecycle, CEF process helper, spell check, inspector layout — all compiled. crust gets these only through hand-declared selectors, if at all.
7. **Zig `libElectrobunCore`** — the RPC WebSocket server itself, plus updater, insights, installer. A Zig-compiled artifact per platform.
8. **Self-extracting bundle + BSDIFF + archive recipes.** Needs a compiled extractor per platform and a build tool (Hutch) that produces zstd archives and recipes. crust's "single binary inside a bundle" cannot self-extract; it must be the bundle.
9. **Hutch itself** — a whole build/workspace CLI with its own resolver and lockfile, its own toolchain store, its own devkit projection into `.hutch/`. crust's `bun`-only story is a fraction of this and should stay that way.
10. **Six main-process runtimes.** Meaningless without a C ABI to bind to.
11. **CEF / WGPU / `<electrobun-webview>` / `<electrobun-wgpu>`.** All are compiled renderer or GPU surfaces. Explicitly out of crust's v1 non-goals, and correctly so.
12. **Windows and Linux entirely.** WebView2 is COM, WebKitGTK is GObject signal-based; their wrappers are 16.5k and 14k lines of C++ respectively. This is direct evidence *for* crust's DESIGN.md §6 warning that adding those platforms will require relaxing the no-artifact rule — Electrobun did not relax it, it built a framework on top of relaxing it.

---

## 10. Net read for crust

Electrobun's answer to "how do you build a webview desktop app in TypeScript" is: **write the native layer in Zig and C++, own the main thread properly, then let the JS runtime be a guest.** That is a good architecture that crust cannot afford.

What crust should take from it is therefore *not* architecture. It is the **IPC design, the sandbox model, the asset-scheme model, the packaging metadata, and the dev-loop taxonomy** — six things that are all cheap, all pure TypeScript or config, and all of which crust's DESIGN.md currently under-specifies. The one place crust is already *ahead* is the security posture (bearer token + `Origin` check + CSP vs their key-only socket with no origin check), and the one place crust is *behind* is main-thread ownership, which is unfixable at crust's chosen constraint level and should be written down as a known, accepted limitation rather than left implicit in §3.